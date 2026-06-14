"""
SQL Generator — converts parsed Excel rows into Oracle SQL UPDATE statements.

WHERE clause strategy
---------------------
  COMPONENT              → CMPNT_NAME = '…'
  LOOP / LINE / PANEL    → LOOP_NAME / LINE_NUM / PANEL_NAME = '…'
  CMPNT-linked satellite → CMPNT_ID = (SELECT … WHERE CMPNT_NAME = '…')
  LOOP-linked / LINE-linked — same subquery pattern

Value quoting
-------------
  NUMBER / INTEGER / FLOAT → unquoted literal
  DATE                     → TO_DATE(…)
  TIMESTAMP                → TO_TIMESTAMP(…)
  STRING / everything else → single-quoted with apostrophes escaped
"""

import re
import collections
import logging
from typing import Tuple

from .schema_loader import (
    get_col_to_table,
    get_full_schema,
    get_cmpnt_linked_tables,
    get_loop_linked_tables,
    get_line_linked_tables,
    SYSTEM_COLUMNS,
    AUDIT_COLUMNS,
    IDENTIFIER_COLUMNS,
)

logger = logging.getLogger(__name__)

_NULL = object()  # sentinel for explicit NULL

_ISO_DATE_RE     = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ISO_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$")


def _normalize_dtype(dtype: str) -> str:
    base = dtype.split("(")[0].upper().strip()
    if base in ("NUMBER", "INTEGER", "INT", "SMALLINT", "DECIMAL", "NUMERIC", "FLOAT", "REAL"):
        return "NUMBER"
    if base == "DATE":
        return "DATE"
    if base.startswith("TIMESTAMP"):
        return "TIMESTAMP"
    return "STRING"


def _format_date_value(val: str, is_timestamp: bool) -> str:
    v  = val.strip().replace("'", "''")
    fn = "TO_TIMESTAMP" if is_timestamp else "TO_DATE"
    if _ISO_DATETIME_RE.match(val.strip()):
        return f"{fn}('{v}', 'YYYY-MM-DD HH24:MI:SS')"
    if _ISO_DATE_RE.match(val.strip()):
        return f"TO_DATE('{v}', 'YYYY-MM-DD')"
    escaped = val.strip().replace("'", "''")
    return f"TO_DATE('{escaped}', 'DD-MON-YYYY')"


def _quote_value(dtype_base: str, val: str) -> str:
    if dtype_base == "NUMBER":
        try:
            float(val)
            return val
        except ValueError:
            logger.warning("Non-numeric value %r for NUMBER column — quoting as string.", val)
    elif dtype_base == "DATE":
        return _format_date_value(val, is_timestamp=False)
    elif dtype_base == "TIMESTAMP":
        return _format_date_value(val, is_timestamp=True)
    return "'" + val.replace("'", "''") + "'"


def _get_default_identifier(table: str,
                             cmpnt: frozenset,
                             loop: frozenset,
                             line: frozenset) -> str | None:
    if table == "COMPONENT":  return "CMPNT_NAME"
    if table == "LOOP":       return "LOOP_NAME"
    if table == "LINE":       return "LINE_NUM"
    if table == "PANEL":      return "PANEL_NAME"
    if table in cmpnt:        return "CMPNT_NAME"
    if table in loop:         return "LOOP_NAME"
    if table in line:         return "LINE_NUM"
    return None


def _build_where(table: str, spi_col: str, val: str,
                 cmpnt: frozenset, loop: frozenset, line: frozenset) -> str:
    escaped = val.replace("'", "''")

    if table in ("COMPONENT", "LOOP", "LINE", "PANEL"):
        if spi_col in SYSTEM_COLUMNS:
            return f"{spi_col} = {val}"
        return f"{spi_col} = '{escaped}'"

    if table in cmpnt:
        if spi_col == "CMPNT_NAME":
            return f"CMPNT_ID = (SELECT CMPNT_ID FROM COMPONENT WHERE CMPNT_NAME = '{escaped}')"
        if spi_col == "CMPNT_ID":
            return f"CMPNT_ID = {val}"
        if spi_col in SYSTEM_COLUMNS:
            return f"{spi_col} = {val}"
        return f"{spi_col} = '{escaped}'"

    if table in loop:
        if spi_col == "LOOP_NAME":
            return f"LOOP_ID = (SELECT LOOP_ID FROM LOOP WHERE LOOP_NAME = '{escaped}')"
        if spi_col == "LOOP_ID":
            return f"LOOP_ID = {val}"
        if spi_col in SYSTEM_COLUMNS:
            return f"{spi_col} = {val}"
        return f"{spi_col} = '{escaped}'"

    if table in line:
        if spi_col == "LINE_NUM":
            return f"LINE_ID = (SELECT LINE_ID FROM LINE WHERE LINE_NUM = '{escaped}')"
        if spi_col == "LINE_ID":
            return f"LINE_ID = {val}"
        if spi_col in SYSTEM_COLUMNS:
            return f"{spi_col} = {val}"
        return f"{spi_col} = '{escaped}'"

    raise ValueError(f"No WHERE clause rule defined for table '{table}'")


def _resolve_where_spi_col(excel_col: str, column_map: dict | None) -> str:
    if excel_col in IDENTIFIER_COLUMNS:
        return excel_col
    if excel_col in SYSTEM_COLUMNS:
        return excel_col
    if column_map and excel_col in column_map:
        return column_map[excel_col]
    return excel_col


def generate_sql_updates(
    rows: list[dict],
    columns: list[str],
    column_map: dict | None = None,
    where_map: dict | None = None,
    null_cols: frozenset | None = None,
    table_map: dict | None = None,
    empty_value_cols: dict | None = None,
    where_spi_map: dict | None = None,
) -> Tuple[dict, list, list]:
    col_to_table_idx = get_col_to_table()
    full_schema      = get_full_schema()

    cmpnt_linked = get_cmpnt_linked_tables()
    loop_linked  = get_loop_linked_tables()
    line_linked  = get_line_linked_tables()

    _null_cols    = null_cols or frozenset()
    _empty_values = empty_value_cols or {}

    col_meta: dict[str, tuple[str, str, str]] = {}
    unknown_columns: list[str] = []

    for col in columns:
        if col in AUDIT_COLUMNS or col in IDENTIFIER_COLUMNS:
            continue
        if col in SYSTEM_COLUMNS and (column_map is None or col not in column_map):
            continue

        spi_col: str | None
        if column_map is not None:
            spi_col = column_map.get(col)
            if not spi_col:
                unknown_columns.append(col)
                continue
        else:
            spi_col = col

        table = col_to_table_idx.get(spi_col) or (table_map and table_map.get(col))
        if not table:
            unknown_columns.append(col)
            continue

        raw_dtype  = full_schema.get(table, {}).get(spi_col, {}).get("dtype", "NVARCHAR2")
        dtype_base = _normalize_dtype(raw_dtype)
        col_meta[col] = (spi_col, table, dtype_base)

    if unknown_columns:
        logger.warning("Unknown/unmapped columns (skipped): %s", unknown_columns)

    table_where: dict[str, tuple[str, str]] = {}
    if where_map:
        for tbl, excel_col in where_map.items():
            spi_col = (where_spi_map or {}).get(tbl) or _resolve_where_spi_col(excel_col, column_map)
            table_where[tbl] = (excel_col, spi_col)

    sql_by_table: dict[str, list[str]] = collections.defaultdict(list)
    errors: list[dict] = []

    for row_idx, row in enumerate(rows, start=2):
        table_updates: dict[str, dict[str, tuple]] = collections.defaultdict(dict)

        for excel_col, (spi_col, table, dtype_base) in col_meta.items():
            val = (row.get(excel_col) or "").strip()
            if val:
                table_updates[table][spi_col] = (val, dtype_base)
            elif excel_col in _null_cols:
                table_updates[table][spi_col] = (_NULL, dtype_base)
            elif excel_col in _empty_values:
                table_updates[table][spi_col] = (_empty_values[excel_col], "STRING")

        if not table_updates:
            continue

        for table, col_vals in table_updates.items():
            if table not in table_where:
                fallback_spi = _get_default_identifier(
                    table, cmpnt_linked, loop_linked, line_linked
                )
                if fallback_spi is None:
                    errors.append({
                        "row": row_idx, "table": table,
                        "message": f"No WHERE identifier defined for table '{table}'",
                    })
                    continue
                fallback_excel = fallback_spi
                if column_map:
                    for ec, sc in column_map.items():
                        if sc == fallback_spi:
                            fallback_excel = ec
                            break
                table_where[table] = (fallback_excel, fallback_spi)

            where_excel, where_spi = table_where[table]
            id_val = (row.get(where_excel) or "").strip()

            if not id_val:
                errors.append({
                    "row": row_idx, "table": table,
                    "message": (
                        f"WHERE identifier '{where_excel}' is empty — "
                        f"cannot build WHERE clause for {table}"
                    ),
                })
                continue

            set_parts: list[str] = []
            for spi_col, (val, dtype_base) in col_vals.items():
                if spi_col == where_spi:
                    continue
                if val is _NULL:
                    set_parts.append(f"{spi_col} = NULL")
                else:
                    set_parts.append(f"{spi_col} = {_quote_value(dtype_base, val)}")

            if not set_parts:
                continue

            try:
                where_clause = _build_where(
                    table, where_spi, id_val,
                    cmpnt_linked, loop_linked, line_linked,
                )
            except ValueError as exc:
                errors.append({"row": row_idx, "table": table, "message": str(exc)})
                continue

            sql_by_table[table].append(
                f"UPDATE {table} SET {', '.join(set_parts)} WHERE {where_clause};"
            )

    return dict(sql_by_table), errors, unknown_columns
