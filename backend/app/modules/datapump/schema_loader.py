"""
SPI Schema Loader — reads pre-built spi_schema.json.
All public functions are lru_cached; the JSON is parsed exactly once per process.
"""
import os
import json
import functools
import logging

logger = logging.getLogger(__name__)

_JSON_PATH = os.path.join(os.path.dirname(__file__), "spi_schema.json")

# Pure audit/metadata columns — never in SET or mapping UI.
AUDIT_COLUMNS: frozenset = frozenset({
    "PROJ_ID", "SITE_ID", "PLANT_ID", "AREA_ID", "UNIT_ID",
    "CHG_NUM", "CHG_STATUS", "CHG_DATE", "USER_NAME",
    "ENG_PROJ_ID", "ENG_REF_ID", "DWG_ID",
    "CASE_ID", "REV_ID", "PD_GEN_ID",
})

# FK/PK numeric ID columns — unquoted in WHERE clauses.
ID_COLUMNS: frozenset = frozenset({
    "CMPNT_ID", "LOOP_ID", "LINE_ID", "PANEL_ID", "EQUIP_ID",
})

SYSTEM_COLUMNS: frozenset = AUDIT_COLUMNS | ID_COLUMNS

# Human-readable identifier columns — WHERE anchors, not in SET.
IDENTIFIER_COLUMNS: frozenset = frozenset({
    "CMPNT_NAME", "LOOP_NAME", "LINE_NUM", "PANEL_NAME", "LOOP_NUM",
})


@functools.lru_cache(maxsize=1)
def _load() -> tuple:
    if not os.path.exists(_JSON_PATH):
        raise RuntimeError(
            f"spi_schema.json not found at {_JSON_PATH}. "
            "The file should be bundled with the datapump module."
        )

    logger.info("Loading SPI schema from %s", _JSON_PATH)
    with open(_JSON_PATH, encoding="utf-8") as fh:
        data = json.load(fh)

    full_schema       = data.get("full_schema", {})
    col_to_table      = data.get("col_to_table", {})
    col_to_tables_all = data.get("col_to_tables_all", {})

    ambiguous = sum(1 for ts in col_to_tables_all.values() if len(ts) > 1)
    logger.info(
        "SPI schema loaded: %d tables, %d unique-column mappings, %d ambiguous columns",
        len(full_schema), len(col_to_table), ambiguous,
    )
    return full_schema, col_to_table, col_to_tables_all


def get_full_schema() -> dict:
    return _load()[0]

def get_col_to_table() -> dict:
    return _load()[1]

def get_col_to_tables_all() -> dict:
    return _load()[2]

def get_dtype(table: str, col: str) -> str:
    return get_full_schema().get(table, {}).get(col, {}).get("dtype", "NVARCHAR2")


@functools.lru_cache(maxsize=1)
def get_cmpnt_linked_tables() -> frozenset:
    schema = get_full_schema()
    return frozenset(
        t for t, cols in schema.items()
        if "CMPNT_ID" in cols and t != "COMPONENT"
    )


@functools.lru_cache(maxsize=1)
def get_loop_linked_tables() -> frozenset:
    schema = get_full_schema()
    return frozenset(
        t for t, cols in schema.items()
        if "LOOP_ID" in cols and "CMPNT_ID" not in cols and t != "LOOP"
    )


@functools.lru_cache(maxsize=1)
def get_line_linked_tables() -> frozenset:
    schema = get_full_schema()
    return frozenset(
        t for t, cols in schema.items()
        if "LINE_ID" in cols
        and "CMPNT_ID" not in cols
        and "LOOP_ID" not in cols
        and t != "LINE"
    )


def get_where_suggestions(table: str) -> list[str]:
    cmpnt = get_cmpnt_linked_tables()
    loop  = get_loop_linked_tables()
    line  = get_line_linked_tables()

    if table == "COMPONENT":  return ["CMPNT_NAME", "CMPNT_ID"]
    if table == "LOOP":       return ["LOOP_NAME",  "LOOP_ID"]
    if table == "LINE":       return ["LINE_NUM",   "LINE_ID"]
    if table == "PANEL":      return ["PANEL_NAME", "PANEL_ID"]
    if table in cmpnt:        return ["CMPNT_NAME", "CMPNT_ID"]
    if table in loop:         return ["LOOP_NAME",  "LOOP_ID"]
    if table in line:         return ["LINE_NUM",   "LINE_ID"]
    return []
