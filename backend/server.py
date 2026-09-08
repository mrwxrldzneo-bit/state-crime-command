from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import jwt
import httpx
from fastapi import (
    FastAPI,
    APIRouter,
    HTTPException,
    Depends,
    Query,
    BackgroundTasks,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config / DB
# ---------------------------------------------------------------------------

mongo_url = os.environ["MONGO_URL"]

client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"

ACCOUNTS = {
    os.environ["DETECTIVE_USERNAME"]: {
        "password": os.environ["DETECTIVE_PASSWORD"],
        "role": "detective",
    },
    os.environ["ADMIN_USERNAME"]: {
        "password": os.environ["ADMIN_PASSWORD"],
        "role": "admin",
    },
}

DIVISIONS = [
    "Organised Crime Squad",
    "Strike Force Raptor",
    "Both",
]

STATUSES = [
    "pending",
    "opened",
    "closed",
    "denied",
]

PRIORITIES = [
    "routine",
    "urgent",
    "high-risk",
]

DISCORD_WEBHOOK_URL = os.environ.get(
    "DISCORD_WEBHOOK_URL",
    "",
).strip()

PRIORITY_COLORS = {
    "routine": 0x41597E,
    "urgent": 0xD4B25A,
    "high-risk": 0xC0392B,
}

DISCORD_PING_ROLE_IDS = [
    "1540123417372532736",
    "1523963881230307338",
]


# ---------------------------------------------------------------------------
# Hosted Discord artwork
# ---------------------------------------------------------------------------

CASE_BANNER_URL = (
    "https://i.postimg.cc/kgknJR43/"
    "Screenshot-2026-09-08-at-6-29-32-AM.png"
)

HELP_BANNER_URL = (
    "https://i.postimg.cc/nzqMbYYS/"
    "Screenshot-2026-09-08-at-6-27-29-AM.png"
)

DISCORD_FOOTER_ICON_URL = (
    "https://i.postimg.cc/2S368f7w/"
    "Screenshot-2026-09-08-at-6-28-15-AM.png"
)


# ---------------------------------------------------------------------------
# Discord helpers
# ---------------------------------------------------------------------------

async def notify_help_discord(
    case: dict,
    user: dict,
    request: dict,
):
    """Send an SCC assistance request to the configured Discord webhook."""

    if not DISCORD_WEBHOOK_URL:
        logger.warning(
            "Discord webhook is not configured; "
            "assistance request was not sent."
        )
        return

    priority = case.get("priority", "routine")

    priority_label = {
        "routine": "Routine",
        "urgent": "Urgent",
        "high-risk": "High-Risk",
    }.get(priority, priority.title())

    officer_id = (
        request.get("officer_id") or ""
    ).strip() or "Not provided"

    username = (
        request.get("username")
        or user.get("username")
        or ""
    ).strip() or "Unknown"

    message = (
        request.get("message") or ""
    ).strip()

    forum = (
        case.get("discord_url") or ""
    ).strip()

    if forum:
        file_line = (
            f"**[Open the full case file]({forum})**"
        )
    else:
        file_line = (
            "*No Discord case file link provided.*"
        )

    embed = {
        "author": {
            "name": "NSWPF · State Crime Command",
        },
        "title": (
            f"Assistance Request — "
            f"{case.get('case_id', 'Unknown Case')}"
        ),
        "description": (
            "An officer has requested assistance through "
            "the **SCC Case Tracker**.\n\n"
            f"**Request:**\n"
            f"{message[:1000]}\n\n"
            f"{file_line}"
        ),
        "color": 0xD4B25A,
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat(),
        "footer": {
            "text": "State Crime Command · Assistance Requests",
            "icon_url": DISCORD_FOOTER_ICON_URL,
        },
        "image": {
            "url": HELP_BANNER_URL,
        },
        "fields": [
            {
                "name": "Case",
                "value": case.get(
                    "name",
                    "Untitled",
                ),
                "inline": True,
            },
            {
                "name": "Priority",
                "value": priority_label,
                "inline": True,
            },
            {
                "name": "Division",
                "value": case.get(
                    "division",
                    "—",
                ),
                "inline": True,
            },
            {
                "name": "Lead Investigator",
                "value": case.get(
                    "lead_investigator",
                    "—",
                ),
                "inline": True,
            },
            {
                "name": "Account",
                "value": username,
                "inline": True,
            },
            {
                "name": "Officer ID",
                "value": officer_id,
                "inline": True,
            },
        ],
    }

    if forum:
        embed["url"] = forum

    payload = {
        "content": "SCC Assistance Request — command attention required.",
        "embeds": [embed],
        "allowed_mentions": {
            "parse": [],
        },
    }

    try:
        async with httpx.AsyncClient(
            timeout=8
        ) as hc:

            response = await hc.post(
                DISCORD_WEBHOOK_URL,
                json=payload,
            )

            if response.is_success:
                logger.info(
                    "Discord assistance notification sent successfully."
                )
            else:
                logger.warning(
                    "Discord assistance webhook rejected request: "
                    "HTTP %s — %s",
                    response.status_code,
                    response.text[:300],
                )

    except Exception as e:
        logger.warning(
            "Discord assistance webhook failed: %s",
            e,
        )


async def notify_discord(case: dict):
    """
    Send the Case Filed Discord notification.

    The ?wait=true parameter makes Discord return the created
    message object so the message ID can be saved in MongoDB.
    """

    if not DISCORD_WEBHOOK_URL:
        logger.warning(
            "Discord webhook is not configured; "
            "case notification was not sent."
        )
        return

    mentions = " ".join(
        f"<@&{rid}>"
        for rid in DISCORD_PING_ROLE_IDS
    )

    priority = case.get(
        "priority",
        "routine",
    )

    priority_label = {
        "routine": "Routine",
        "urgent": "Urgent",
        "high-risk": "High-Risk",
    }.get(
        priority,
        priority.title(),
    )

    forum = (
        case.get("discord_url") or ""
    ).strip()

    if forum:
        file_line = (
            f"**[Open the full case file]({forum})**"
        )
    else:
        file_line = (
            "*Full case file will be posted in the Discord forum.*"
        )

    fields = [
        {
            "name": "Case ID",
            "value": case.get(
                "case_id",
                "—",
            ),
            "inline": True,
        },
        {
            "name": "Priority",
            "value": priority_label,
            "inline": True,
        },
        {
            "name": "Status",
            "value": "Pending Review",
            "inline": True,
        },
        {
            "name": "Lead Investigator",
            "value": case.get(
                "lead_investigator",
                "—",
            ),
            "inline": True,
        },
        {
            "name": "Logged By",
            "value": case.get(
                "created_by",
                "—",
            ),
            "inline": True,
        },
    ]

    embed = {
        "author": {
            "name": "NSWPF · State Crime Command",
        },
        "title": (
            f"New Case Filed - "
            f"{case.get('name', 'Untitled')}"
        ),
        "description": (
            "A new case has been logged in the "
            "**Case Tracker** and is awaiting command review.\n\n"
            "This is only a **tracker alert**, please approve "
            "this **[via the Case Tracker]"
            "(https://scc-dashboard.onrender.com/cases)** "
            "before checking and confirming the correct details.\n\n"
            f"{file_line}"
        ),
        "color": PRIORITY_COLORS.get(
            priority,
            0x41597E,
        ),
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat(),
        "footer": {
            "text": "State Crime Command · Case File Registry",
            "icon_url": DISCORD_FOOTER_ICON_URL,
        },
        "image": {
            "url": CASE_BANNER_URL,
        },
        "fields": fields,
    }

    if forum:
        embed["url"] = forum

    payload = {
        "content": mentions,
        "embeds": [embed],
        "allowed_mentions": {
            "parse": ["roles"],
        },
    }

    try:
        webhook_url = (
            f"{DISCORD_WEBHOOK_URL}"
            f"{'&' if '?' in DISCORD_WEBHOOK_URL else '?'}"
            "wait=true"
        )

        async with httpx.AsyncClient(
            timeout=8
        ) as hc:

            response = await hc.post(
                webhook_url,
                json=payload,
            )

            if not response.is_success:
                logger.warning(
                    "Discord case notification failed: "
                    "HTTP %s — %s",
                    response.status_code,
                    response.text[:500],
                )
                return

            try:
                message_data = response.json()
            except Exception:
                logger.warning(
                    "Discord case notification succeeded "
                    "but returned invalid JSON."
                )
                return

            message_id = message_data.get("id")
            channel_id = message_data.get("channel_id")

            if not message_id:
                logger.warning(
                    "Discord notification succeeded but "
                    "no message ID was returned."
                )
                return

            await db.cases.update_one(
                {
                    "id": case.get("id"),
                },
                {
                    "$set": {
                        "discord_message_id": message_id,
                        "discord_channel_id": channel_id,
                    }
                },
            )

            logger.info(
                "Discord case notification sent successfully. "
                "Message ID saved: %s",
                message_id,
            )

    except Exception as e:
        logger.warning(
            "Discord case webhook failed: %s",
            e,
        )


async def send_case_review_notification(
    case: dict,
    action: str,
    username: str,
    timestamp: str,
):
    """
    Send an approval/denial notification.

    Discord incoming webhooks cannot currently create a true
    reply to an existing message, so this sends a separate
    review notification through the same webhook.
    """

    if not DISCORD_WEBHOOK_URL:
        return

    is_approved = action == "approved"

    title = (
        "Case Approved"
        if is_approved
        else "Case Denied"
    )

    color = (
        0x2E8B57
        if is_approved
        else 0xC0392B
    )

    description = (
        "The case has been approved and is now open."
        if is_approved
        else
        "The case has been denied during command review."
    )

    embed = {
        "author": {
            "name": "NSWPF · State Crime Command",
        },
        "title": title,
        "description": description,
        "color": color,
        "timestamp": timestamp,
        "footer": {
            "text": "State Crime Command · Case Review",
            "icon_url": DISCORD_FOOTER_ICON_URL,
        },
        "fields": [
            {
                "name": "Case ID",
                "value": case.get(
                    "case_id",
                    "—",
                ),
                "inline": True,
            },
            {
                "name": (
                    "Approved By"
                    if is_approved
                    else "Denied By"
                ),
                "value": username,
                "inline": True,
            },
            {
                "name": (
                    "Approval Time"
                    if is_approved
                    else "Denial Time"
                ),
                "value": timestamp,
                "inline": False,
            },
        ],
    }

    payload = {
        "content": "",
        "embeds": [embed],
        "allowed_mentions": {
            "parse": [],
        },
    }

    try:
        async with httpx.AsyncClient(
            timeout=8
        ) as hc:

            response = await hc.post(
                DISCORD_WEBHOOK_URL,
                json=payload,
            )

            if not response.is_success:
                logger.warning(
                    "Discord review notification failed: "
                    "HTTP %s — %s",
                    response.status_code,
                    response.text[:500],
                )

    except Exception as e:
        logger.warning(
            "Discord review notification failed: %s",
            e,
        )


# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------

app = FastAPI()

api_router = APIRouter(
    prefix="/api"
)

security = HTTPBearer(
    auto_error=False
)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def create_access_token(
    username: str,
    role: str,
) -> str:

    payload = {
        "sub": username,
        "role": role,
        "exp": datetime.now(
            timezone.utc
        ) + timedelta(hours=12),
        "type": "access",
    }

    return jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


async def get_current_user(
    creds: Optional[
        HTTPAuthorizationCredentials
    ] = Depends(security),
) -> dict:

    if creds is None:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
        )

    try:
        payload = jwt.decode(
            creds.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
        )

        return {
            "username": payload["sub"],
            "role": payload.get(
                "role",
                "detective",
            ),
        }

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Session expired. Please log in again.",
        )

    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials. Access denied.",
        )


async def require_admin(
    user: dict = Depends(get_current_user),
) -> dict:

    if user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail=(
                "Administrator clearance required "
                "for this action."
            ),
        )

    return user


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class CaseCreate(BaseModel):
    name: str
    lead_investigator: str
    division: str
    synopsis: str = ""
    discord_url: str = ""
    priority: str = "routine"


class CaseUpdate(BaseModel):
    name: Optional[str] = None
    lead_investigator: Optional[str] = None
    division: Optional[str] = None
    synopsis: Optional[str] = None
    discord_url: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None


class HelpRequest(BaseModel):
    message: str
    officer_id: str = ""
    username: str = ""


class NoteCreate(BaseModel):
    note: str


class TimelineNote(BaseModel):
    id: str = Field(
        default_factory=lambda: str(uuid.uuid4())
    )
    note: str
    author: str
    kind: str = "note"
    created_at: str


class Case(BaseModel):
    id: str = Field(
        default_factory=lambda: str(uuid.uuid4())
    )

    case_id: str
    name: str
    lead_investigator: str
    division: str
    synopsis: str = ""
    discord_url: str = ""

    status: str = "pending"
    priority: str = "routine"

    notes: List[TimelineNote] = Field(
        default_factory=list
    )

    approved_by: Optional[str] = None
    approved_at: Optional[str] = None

    denied_by: Optional[str] = None
    denied_at: Optional[str] = None

    discord_message_id: Optional[str] = None
    discord_channel_id: Optional[str] = None

    created_by: str
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(
        timezone.utc
    ).isoformat()


async def generate_case_id() -> str:

    year = datetime.now(
        timezone.utc
    ).year

    highest = 0

    async for doc in db.cases.find(
        {},
        {
            "case_id": 1,
            "_id": 0,
        },
    ):

        cid = doc.get(
            "case_id",
            "",
        )

        try:
            highest = max(
                highest,
                int(
                    cid.rsplit(
                        "-",
                        1,
                    )[-1]
                ),
            )

        except (
            ValueError,
            IndexError,
        ):
            continue

    return f"SCC-{year}-{highest + 1:03d}"


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@api_router.post("/auth/login")
async def login(
    body: LoginRequest,
):

    account = ACCOUNTS.get(
        body.username
    )

    if (
        not account
        or account["password"] != body.password
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials. Access denied.",
        )

    token = create_access_token(
        body.username,
        account["role"],
    )

    return {
        "token": token,
        "username": body.username,
        "role": account["role"],
    }


@api_router.get("/auth/me")
async def me(
    user: dict = Depends(get_current_user),
):
    return user


# ---------------------------------------------------------------------------
# General case routes
# ---------------------------------------------------------------------------

@api_router.get("/config")
async def get_config(
    user: dict = Depends(get_current_user),
):

    return {
        "divisions": DIVISIONS,
        "statuses": STATUSES,
        "priorities": PRIORITIES,
    }


@api_router.get("/stats")
async def stats(
    user: dict = Depends(get_current_user),
):

    pending = await db.cases.count_documents(
        {"status": "pending"}
    )

    opened = await db.cases.count_documents(
        {"status": "opened"}
    )

    closed = await db.cases.count_documents(
        {"status": "closed"}
    )

    denied = await db.cases.count_documents(
        {"status": "denied"}
    )

    return {
        "pending": pending,
        "opened": opened,
        "closed": closed,
        "denied": denied,
        "total": (
            pending
            + opened
            + closed
            + denied
        ),
    }


@api_router.get(
    "/cases",
    response_model=List[Case],
)
async def list_cases(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):

    query = {}

    if status and status in STATUSES:
        query["status"] = status

    if search:
        query["$or"] = [
            {
                "name": {
                    "$regex": search,
                    "$options": "i",
                }
            },
            {
                "lead_investigator": {
                    "$regex": search,
                    "$options": "i",
                }
            },
            {
                "division": {
                    "$regex": search,
                    "$options": "i",
                }
            },
            {
                "case_id": {
                    "$regex": search,
                    "$options": "i",
                }
            },
        ]

    docs = await db.cases.find(
        query,
        {"_id": 0},
    ).sort(
        "created_at",
        -1,
    ).to_list(1000)

    return docs


@api_router.get(
    "/cases/{case_uid}",
    response_model=Case,
)
async def get_case(
    case_uid: str,
    user: dict = Depends(get_current_user),
):

    doc = await db.cases.find_one(
        {"id": case_uid},
        {"_id": 0},
    )

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Case file not found.",
        )

    return doc


# ---------------------------------------------------------------------------
# Create case
# ---------------------------------------------------------------------------

@api_router.post(
    "/cases",
    response_model=Case,
)
async def create_case(
    body: CaseCreate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):

    if body.division not in DIVISIONS:
        raise HTTPException(
            status_code=400,
            detail="Invalid division selected.",
        )

    if body.priority not in PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail="Invalid priority selected.",
        )

    ts = now_iso()

    case = Case(
        case_id=await generate_case_id(),
        name=body.name,
        lead_investigator=body.lead_investigator,
        division=body.division,
        synopsis=body.synopsis,
        discord_url=body.discord_url,
        priority=body.priority,
        status="pending",
        notes=[
            TimelineNote(
                note=(
                    f"Case file logged by "
                    f"{user['username']} — "
                    "awaiting command review."
                ),
                author=user["username"],
                kind="system",
                created_at=ts,
            )
        ],
        created_by=user["username"],
        created_at=ts,
        updated_at=ts,
    )

    await db.cases.insert_one(
        case.model_dump()
    )

    background_tasks.add_task(
        notify_discord,
        case.model_dump(),
    )

    return case


# ---------------------------------------------------------------------------
# Help request
# ---------------------------------------------------------------------------

@api_router.post(
    "/cases/{case_uid}/help"
)
async def request_case_help(
    case_uid: str,
    body: HelpRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):

    case = await db.cases.find_one(
        {
            "$or": [
                {"id": case_uid},
                {"case_id": case_uid},
            ]
        },
        {"_id": 0},
    )

    if not case:
        raise HTTPException(
            status_code=404,
            detail="Case file not found.",
        )

    message = body.message.strip()

    if not message:
        raise HTTPException(
            status_code=400,
            detail=(
                "Please describe what "
                "assistance is required."
            ),
        )

    request_data = {
        "message": message,
        "officer_id": body.officer_id.strip(),
        "username": user["username"],
    }

    background_tasks.add_task(
        notify_help_discord,
        case,
        user,
        request_data,
    )

    return {
        "message": "Assistance request sent."
    }


# ---------------------------------------------------------------------------
# Update case
# ---------------------------------------------------------------------------

@api_router.put(
    "/cases/{case_uid}",
    response_model=Case,
)
async def update_case(
    case_uid: str,
    body: CaseUpdate,
    user: dict = Depends(get_current_user),
):

    doc = await db.cases.find_one(
        {"id": case_uid},
        {"_id": 0},
    )

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Case file not found.",
        )

    updates = {
        k: v
        for k, v in body.model_dump(
            exclude_none=True
        ).items()
    }

    if "status" in updates:

        if user["role"] != "admin":
            updates.pop("status")

        elif updates["status"] not in STATUSES:
            raise HTTPException(
                status_code=400,
                detail="Invalid status.",
            )

    if (
        "division" in updates
        and updates["division"] not in DIVISIONS
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid division selected.",
        )

    if (
        "priority" in updates
        and updates["priority"] not in PRIORITIES
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid priority selected.",
        )

    updates["updated_at"] = now_iso()

    await db.cases.update_one(
        {"id": case_uid},
        {"$set": updates},
    )

    doc = await db.cases.find_one(
        {"id": case_uid},
        {"_id": 0},
    )

    return doc


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

@api_router.post(
    "/cases/{case_uid}/notes",
    response_model=Case,
)
async def add_note(
    case_uid: str,
    body: NoteCreate,
    user: dict = Depends(get_current_user),
):

    note_text = body.note.strip()

    if not note_text:
        raise HTTPException(
            status_code=400,
            detail="Note cannot be empty.",
        )

    doc = await db.cases.find_one(
        {"id": case_uid},
        {"_id": 0},
    )

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Case file not found.",
        )

    ts = now_iso()

    entry = TimelineNote(
        note=note_text,
        author=user["username"],
        kind="note",
        created_at=ts,
    )

    await db.cases.update_one(
        {"id": case_uid},
        {
            "$push": {
                "notes": entry.model_dump()
            },
            "$set": {
                "updated_at": ts
            },
        },
    )

    doc = await db.cases.find_one(
        {"id": case_uid},
        {"_id": 0},
    )

    return doc


# ---------------------------------------------------------------------------
# Approve case
# ---------------------------------------------------------------------------

@api_router.post(
    "/cases/{case_uid}/approve",
    response_model=Case,
)
async def approve_case(
    case_uid: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin),
):

    doc = await db.cases.find_one(
        {"id": case_uid},
        {"_id": 0},
    )

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Case file not found.",
        )

    if doc.get("status") != "pending":
        raise HTTPException(
            status_code=400,
            detail=(
                "Only pending cases can be approved."
            ),
        )

    ts = now_iso()

    entry = TimelineNote(
        note=(
            f"Case approved and opened by "
            f"{user['username']}."
        ),
        author=user["username"],
        kind="system",
        created_at=ts,
    )

    await db.cases.update_one(
        {"id": case_uid},
        {
            "$set": {
                "status": "opened",
                "approved_by": user["username"],
                "approved_at": ts,
                "updated_at": ts,
            },
            "$push": {
                "notes": entry.model_dump()
            },
        },
    )

    doc = await db.cases.find_one(
        {"id": case_uid},
        {"_id": 0},
    )

    background_tasks.add_task(
        send_case_review_notification,
        doc,
        "approved",
        user["username"],
        ts,
    )

    return doc


# ---------------------------------------------------------------------------
# Deny case
# ---------------------------------------------------------------------------

@api_router.post(
    "/cases/{case_uid}/deny",
    response_model=Case,
)
async def deny_case(
    case_uid: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin),
):

    doc = await db.cases.find_one(
        {"id": case_uid},
        {"_id": 0},
    )

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Case file not found.",
        )

    if doc.get("status") != "pending":
        raise HTTPException(
            status_code=400,
            detail=(
                "Only pending cases can be denied."
            ),
        )

    ts = now_iso()

    entry = TimelineNote(
        note=(
            f"Case denied by "
            f"{user['username']}."
        ),
        author=user["username"],
        kind="system",
        created_at=ts,
    )

    await db.cases.update_one(
        {"id": case_uid},
        {
            "$set": {
                "status": "denied",
                "denied_by": user["username"],
                "denied_at": ts,
                "updated_at": ts,
            },
            "$push": {
                "notes": entry.model_dump()
            },
        },
    )

    doc = await db.cases.find_one(
        {"id": case_uid},
        {"_id": 0},
    )

    background_tasks.add_task(
        send_case_review_notification,
        doc,
        "denied",
        user["username"],
        ts,
    )

    return doc


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@api_router.delete(
    "/cases/{case_uid}"
)
async def delete_case(
    case_uid: str,
    user: dict = Depends(require_admin),
):

    result = await db.cases.delete_one(
        {"id": case_uid}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Case file not found.",
        )

    return {
        "deleted": True
    }


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------

SEED_CASES = []


async def seed_cases():
    """
    Deliberately disabled.

    Case files must be created through the
    authenticated application and must never
    be auto-seeded.
    """
    return


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup():
    pass


app.include_router(
    api_router
)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get(
        "CORS_ORIGINS",
        "*",
    ).split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()