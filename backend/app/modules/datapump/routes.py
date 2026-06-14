"""
DataPump API Routes
"""
import io
import json
import zipfile
import logging
import asyncio
from collections import Counter
from functools import partial

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response

from .excel_parser import parse_upload_excel, read_header_row
from .sql_generator import generate_sql_updates, _normalize_dtype
from .schema_loader import (
    get_col_to_table, get_full_schema, get_dtype,
    SYSTEM_COLUMNS, AUDIT_COLUMNS, IDENTIFIER_COLUMNS,
)

logger = logging.getLogger(__name__)

PREFIX = "/api/v1/datapump"
router = APIRouter()

_ALLOWED_EXT    = (".xlsx", ".xls")
_MAX_FILE_BYTES = 50 * 1024 * 1024   # 50 MB


def _validate_file(filename: str) -> None:
    if not any(filename.lower().endswith(ext) for ext in _ALLOWED_EXT):
        raise HTTPException(status_code=400, detail="Only .xlsx and .xls files are supported.")


def _validate_size(content: bytes) -> None:
    if len(content) > _MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(content) / 1_048_576:.1f} MB). Maximum allowed is 50 MB.",
        )


def _parse_json_form(value: str, field_name: str) -> dict | list | None:
    stripped = value.strip()
    if not stripped or stripped in ("{}", "[]"):
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} JSON: {exc}") from exc


def _build_zip(sql_by_table: dict, base_name: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for table, statements in sql_by_table.items():
            zf.writestr(
                f"{base_name}_{table}.sql",
                ("\n".join(statements) + "\n").encode("utf-8"),
            )
    return buf.getvalue()


def _process(
    file_content: bytes,
    filename: str,
    column_map: dict | None,
    where_map: dict | None,
    null_cols: frozenset | None,
    table_map: dict | None,
    empty_value_cols: dict | None = None,
    where_spi_map: dict | None = None,
) -> dict:
    rows, columns = parse_upload_excel(file_content, filename)
    sql_by_table, errors, unknown_columns = generate_sql_updates(
        rows, columns,
        column_map=column_map,
        where_map=where_map,
        null_cols=null_cols,
        table_map=table_map,
        empty_value_cols=empty_value_cols,
        where_spi_map=where_spi_map,
    )
    return {
        "rows": rows,
        "columns": columns,
        "sql_by_table": sql_by_table,
        "errors": errors,
        "unknown_columns": unknown_columns,
    }


# ---------------------------------------------------------------------------
# Schema endpoints
# ---------------------------------------------------------------------------

@router.get("/schema/tables")
async def list_tables():
    schema = get_full_schema()
    return Response(
        content=json.dumps({"tables": sorted(schema.keys())}),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/schema/columns")
async def get_columns_for_tables(tables: str = Query(default="")):
    if not tables.strip():
        return Response(
            content=json.dumps({"columns": {}}),
            media_type="application/json",
            headers={"Cache-Control": "no-store"},
        )
    table_list = [t.strip() for t in tables.split(",") if t.strip()][:10]
    schema = get_full_schema()
    columns = {
        table: sorted(c for c in schema[table] if c not in AUDIT_COLUMNS)
        for table in table_list if table in schema
    }
    where_columns = {
        table: sorted(schema[table].keys())
        for table in table_list if table in schema
    }
    return Response(
        content=json.dumps({"columns": columns, "where_columns": where_columns}),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


# ---------------------------------------------------------------------------
# Stage 1 — read headers
# ---------------------------------------------------------------------------

@router.post("/headers")
async def get_headers(file: UploadFile = File(...)):
    _validate_file(file.filename or "")
    try:
        file_content = await file.read()
        _validate_size(file_content)
        logger.info("DataPump /headers: %s (%d bytes)", file.filename, len(file_content))

        loop = asyncio.get_event_loop()
        headers: list[str] = await loop.run_in_executor(
            None, partial(read_header_row, file_content)
        )

        col_to_table = get_col_to_table()
        mapping = []
        for col in headers:
            if col in IDENTIFIER_COLUMNS:
                mapping.append({"column": col, "spi_column": col, "table": None, "category": "identifier"})
            elif col in AUDIT_COLUMNS:
                mapping.append({"column": col, "spi_column": col, "table": None, "category": "system"})
            else:
                table = col_to_table.get(col)
                dtype = _normalize_dtype(get_dtype(table, col)) if table else None
                mapping.append({
                    "column":     col,
                    "spi_column": col if table else None,
                    "table":      table,
                    "category":   "data",
                    "data_type":  dtype,
                })

        mapped   = sum(1 for m in mapping if m["category"] == "data" and m["table"])
        unmapped = sum(1 for m in mapping if m["category"] == "data" and not m["table"])
        logger.info("Headers read: %d columns (%d mapped, %d unknown)", len(headers), mapped, unmapped)
        return {"filename": file.filename, "headers": headers, "mapping": mapping}

    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("DataPump /headers error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read headers: {exc}") from exc


# ---------------------------------------------------------------------------
# Stage 2 — generate ZIP
# ---------------------------------------------------------------------------

@router.post("/generate-zip")
async def generate_zip(
    file:             UploadFile = File(...),
    column_map:       str        = Form("{}"),
    where_map:        str        = Form("{}"),
    where_spi_map:    str        = Form("{}"),
    null_cols:        str        = Form("[]"),
    table_map:        str        = Form("{}"),
    empty_value_cols: str        = Form("{}"),
):
    _validate_file(file.filename or "")
    try:
        parsed_map       = _parse_json_form(column_map,       "column_map")
        parsed_where     = _parse_json_form(where_map,        "where_map")
        parsed_where_spi = _parse_json_form(where_spi_map,    "where_spi_map")
        parsed_table     = _parse_json_form(table_map,        "table_map")
        parsed_empty     = _parse_json_form(empty_value_cols, "empty_value_cols")
        raw_null         = _parse_json_form(null_cols,        "null_cols")

        if raw_null is not None and not isinstance(raw_null, list):
            raise HTTPException(status_code=400, detail="null_cols must be a JSON array.")
        parsed_null: frozenset | None = frozenset(raw_null) if raw_null else None

        file_content = await file.read()
        _validate_size(file_content)
        logger.info("DataPump /generate-zip: %s (%d bytes)", file.filename, len(file_content))

        loop   = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(_process, file_content, file.filename or "",
                    parsed_map, parsed_where, parsed_null, parsed_table,
                    parsed_empty, parsed_where_spi),
        )

        sql_by_table = result["sql_by_table"]
        errors       = result["errors"]

        if not sql_by_table:
            raise HTTPException(
                status_code=422,
                detail=(
                    "No SQL statements were generated. Check: (1) the WHERE identifier column "
                    "has values in the file, (2) at least one data column is mapped, "
                    "(3) rows were not all skipped due to errors."
                ),
            )

        base_name = (file.filename or "datapump").rsplit(".", 1)[0]
        zip_bytes = _build_zip(sql_by_table, base_name)

        table_count = len(sql_by_table)
        stmt_count  = sum(len(v) for v in sql_by_table.values())
        logger.info(
            "ZIP generated: %d tables, %d statements, %d bytes, %d errors",
            table_count, stmt_count, len(zip_bytes), len(errors),
        )

        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{base_name}_SQL_Updates.zip"',
                "Content-Length":      str(len(zip_bytes)),
                "X-Table-Count":       str(table_count),
                "X-Statement-Count":   str(stmt_count),
                "X-Error-Count":       str(len(errors)),
            },
        )

    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("DataPump /generate-zip error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate ZIP: {exc}") from exc


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

@router.post("/preview")
async def preview_sql(
    file:             UploadFile = File(...),
    column_map:       str        = Form("{}"),
    where_map:        str        = Form("{}"),
    where_spi_map:    str        = Form("{}"),
    null_cols:        str        = Form("[]"),
    table_map:        str        = Form("{}"),
    empty_value_cols: str        = Form("{}"),
):
    _validate_file(file.filename or "")
    try:
        parsed_map       = _parse_json_form(column_map,       "column_map")
        parsed_where     = _parse_json_form(where_map,        "where_map")
        parsed_where_spi = _parse_json_form(where_spi_map,    "where_spi_map")
        parsed_table     = _parse_json_form(table_map,        "table_map")
        parsed_empty     = _parse_json_form(empty_value_cols, "empty_value_cols")
        raw_null         = _parse_json_form(null_cols,        "null_cols")

        if raw_null is not None and not isinstance(raw_null, list):
            raise HTTPException(status_code=400, detail="null_cols must be a JSON array.")
        parsed_null: frozenset | None = frozenset(raw_null) if raw_null else None

        file_content = await file.read()
        _validate_size(file_content)
        logger.info("DataPump /preview: %s (%d bytes)", file.filename, len(file_content))

        loop   = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(_process, file_content, file.filename or "",
                    parsed_map, parsed_where, parsed_null, parsed_table,
                    parsed_empty, parsed_where_spi),
        )

        rows         = result["rows"]
        sql_by_table = result["sql_by_table"]
        errors       = result["errors"]
        unknown_cols = result["unknown_columns"]

        sql_preview = {tbl: stmts[:5] for tbl, stmts in sql_by_table.items()}

        duplicates: dict[str, list] = {}
        for tbl, stmts in sql_by_table.items():
            where_vals = []
            for stmt in stmts:
                if "WHERE " in stmt:
                    where_vals.append(stmt.split("WHERE ", 1)[1].rstrip(";").strip())
            counts = Counter(where_vals)
            dups = [[wv, cnt] for wv, cnt in counts.most_common() if cnt > 1]
            if dups:
                duplicates[tbl] = dups[:10]

        logger.info(
            "Preview: %d rows, %d statements, %d errors",
            len(rows), sum(len(v) for v in sql_by_table.values()), len(errors),
        )

        return {
            "total_rows":      len(rows),
            "stmt_count":      sum(len(v) for v in sql_by_table.values()),
            "table_counts":    {tbl: len(stmts) for tbl, stmts in sql_by_table.items()},
            "error_count":     len(errors),
            "errors":          errors[:20],
            "unknown_columns": unknown_cols,
            "duplicates":      duplicates,
            "sql_preview":     sql_preview,
        }

    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("DataPump /preview error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate preview: {exc}") from exc
