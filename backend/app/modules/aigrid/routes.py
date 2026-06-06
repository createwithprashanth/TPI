from typing import List, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.config.local_db import connection, json_text, row_to_dict

router = APIRouter()
PREFIX = "/api/v1/aigrid"
TAGS = ["AI Grid"]


def _user_id(request: Request) -> str:
    user = getattr(request.state, "user", None)
    return str(getattr(user, "id", "local-user"))


class SavedView(BaseModel):
    name: str
    visibleColumns: List[str]
    columnOrder: List[str]
    columnWidths: dict
    pinnedColumns: List[str] = Field(default_factory=list)


class GridPreferencesUpdate(BaseModel):
    visible_columns: List[str]
    column_order: List[str]
    column_widths: Optional[dict] = Field(default_factory=dict)
    pinned_columns: Optional[List[str]] = Field(default_factory=list)
    saved_views: Optional[List[SavedView]] = Field(default_factory=list)


@router.get("/preferences/{datasource_id}", tags=TAGS)
async def get_preferences(request: Request, datasource_id: str) -> dict:
    user_id = _user_id(request)
    with connection() as conn:
        row = conn.execute(
            """
            SELECT visible_columns, column_order, column_widths, pinned_columns, saved_views
            FROM user_grid_preferences
            WHERE user_id=? AND datasource_id=?
            LIMIT 1
            """,
            (user_id, datasource_id),
        ).fetchone()
    if row:
        return row_to_dict(row) or {}
    return {
        "visible_columns": [],
        "column_order": [],
        "column_widths": {},
        "pinned_columns": [],
        "saved_views": [],
    }


@router.put("/preferences/{datasource_id}", tags=TAGS)
async def save_preferences(request: Request, datasource_id: str, body: GridPreferencesUpdate) -> dict:
    user_id = _user_id(request)
    row = {
        "user_id": user_id,
        "datasource_id": datasource_id,
        "visible_columns": json_text(body.visible_columns, []),
        "column_order": json_text(body.column_order, []),
        "column_widths": json_text(body.column_widths, {}),
        "pinned_columns": json_text(body.pinned_columns, []),
        "saved_views": json_text([v.model_dump() for v in (body.saved_views or [])], []),
    }
    with connection() as conn:
        conn.execute(
            """
            INSERT INTO user_grid_preferences
              (user_id, datasource_id, visible_columns, column_order, column_widths, pinned_columns, saved_views)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, datasource_id) DO UPDATE SET
              visible_columns=excluded.visible_columns,
              column_order=excluded.column_order,
              column_widths=excluded.column_widths,
              pinned_columns=excluded.pinned_columns,
              saved_views=excluded.saved_views,
              updated_at=CURRENT_TIMESTAMP
            """,
            (
                row["user_id"],
                row["datasource_id"],
                row["visible_columns"],
                row["column_order"],
                row["column_widths"],
                row["pinned_columns"],
                row["saved_views"],
            ),
        )
        saved = conn.execute(
            """
            SELECT visible_columns, column_order, column_widths, pinned_columns, saved_views
            FROM user_grid_preferences
            WHERE user_id=? AND datasource_id=?
            """,
            (user_id, datasource_id),
        ).fetchone()
    return row_to_dict(saved) or {}
