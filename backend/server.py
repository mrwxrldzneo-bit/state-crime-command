from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import jwt
import httpx
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Query, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Config / DB
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"

ACCOUNTS = {
    os.environ['DETECTIVE_USERNAME']: {
        "password": os.environ['DETECTIVE_PASSWORD'],
        "role": "detective",
    },
    os.environ['ADMIN_USERNAME']: {
        "password": os.environ['ADMIN_PASSWORD'],
        "role": "admin",
    },
}

DIVISIONS = ["Organised Crime Squad", "Strike Force Raptor", "Both"]
STATUSES = ["pending", "opened", "closed"]
PRIORITIES = ["routine", "urgent", "high-risk"]

DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
PRIORITY_COLORS = {"routine": 0x41597E, "urgent": 0xD4B25A, "high-risk": 0xC0392B}
DISCORD_PING_ROLE_IDS = ["1540123417372532736", "1523963881230307338"]


async def notify_discord(case: dict):
    """Fire-and-forget Discord ping when a new case is logged. Never raises into the request."""
    if not DISCORD_WEBHOOK_URL:
        return
    mentions = " ".join(f"<@&{rid}>" for rid in DISCORD_PING_ROLE_IDS)
    priority = case.get("priority", "routine")
    priority_label = {
        "routine": "🟦 Routine",
        "urgent": "🟨 Urgent",
        "high-risk": "🟥 High-Risk",
    }.get(priority, priority.title())

    forum = (case.get("discord_url") or "").strip()
    if forum:
        file_line = f"📂 **[Open the full case file in the forum →]({forum})**"
    else:
        file_line = "📂 *Full case file will be posted in the Discord forum.*"

    fields = [
        {"name": "Case ID", "value": case.get("case_id", "—"), "inline": True},
        {"name": "Priority", "value": priority_label, "inline": True},
        {"name": "Status", "value": "🟡 Pending Review", "inline": True},
        {"name": "Division", "value": case.get("division", "—"), "inline": True},
        {"name": "Lead Investigator", "value": case.get("lead_investigator", "—"), "inline": True},
        {"name": "Logged By", "value": case.get("created_by", "—"), "inline": True},
    ]
    synopsis = (case.get("synopsis") or "").strip()
    if synopsis:
        fields.append({
            "name": "Synopsis",
            "value": synopsis[:300] + ("…" if len(synopsis) > 300 else ""),
            "inline": False,
        })

    embed = {
        "author": {"name": "NSWPF · State Crime Command"},
        "title": f"🔔 New Case Filed — {case.get('name', 'Untitled')}",
        "description": (
            "A new case has been logged in the **Case Tracker** and is awaiting command review.\n"
            "This is only a tracker alert — the actual investigation lives in the Discord forum.\n\n"
            f"{file_line}"
        ),
        "color": PRIORITY_COLORS.get(priority, 0x41597E),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "footer": {"text": "State Crime Command · Case File Registry"},
        "fields": fields,
    }
    if forum:
        embed["url"] = forum

    payload = {
        "content": f"{mentions} — a new case needs review 📌",
        "embeds": [embed],
        "allowed_mentions": {"parse": ["roles"]},
    }
    try:
        async with httpx.AsyncClient(timeout=8) as hc:
            await hc.post(DISCORD_WEBHOOK_URL, json=payload)
    except Exception as e:  # noqa: BLE001
        logger.warning("Discord webhook failed: %s", e)

app = FastAPI()
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def create_access_token(username: str, role: str) -> str:
    payload = {
        "sub": username,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {"username": payload["sub"], "role": payload.get("role", "detective")}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid credentials. Access denied.")


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Administrator clearance required for this action.")
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


class NoteCreate(BaseModel):
    note: str


class TimelineNote(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    note: str
    author: str
    kind: str = "note"  # note | system
    created_at: str


class Case(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    case_id: str
    name: str
    lead_investigator: str
    division: str
    synopsis: str = ""
    discord_url: str = ""
    status: str = "pending"
    priority: str = "routine"
    notes: List[TimelineNote] = Field(default_factory=list)
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    created_by: str
    created_at: str
    updated_at: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def generate_case_id() -> str:
    year = datetime.now(timezone.utc).year
    highest = 0
    async for doc in db.cases.find({}, {"case_id": 1, "_id": 0}):
        cid = doc.get("case_id", "")
        try:
            highest = max(highest, int(cid.rsplit("-", 1)[-1]))
        except (ValueError, IndexError):
            continue
    return f"SCC-{year}-{highest + 1:03d}"


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/login")
async def login(body: LoginRequest):
    account = ACCOUNTS.get(body.username)
    if not account or account["password"] != body.password:
        raise HTTPException(status_code=401, detail="Invalid credentials. Access denied.")
    token = create_access_token(body.username, account["role"])
    return {"token": token, "username": body.username, "role": account["role"]}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------------------------------------------------------------------------
# Case routes
# ---------------------------------------------------------------------------
@api_router.get("/config")
async def get_config(user: dict = Depends(get_current_user)):
    return {"divisions": DIVISIONS, "statuses": STATUSES, "priorities": PRIORITIES}


@api_router.get("/stats")
async def stats(user: dict = Depends(get_current_user)):
    pending = await db.cases.count_documents({"status": "pending"})
    opened = await db.cases.count_documents({"status": "opened"})
    closed = await db.cases.count_documents({"status": "closed"})
    return {"pending": pending, "opened": opened, "closed": closed, "total": pending + opened + closed}


@api_router.get("/cases", response_model=List[Case])
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
            {"name": {"$regex": search, "$options": "i"}},
            {"lead_investigator": {"$regex": search, "$options": "i"}},
            {"division": {"$regex": search, "$options": "i"}},
            {"case_id": {"$regex": search, "$options": "i"}},
        ]
    docs = await db.cases.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@api_router.get("/cases/{case_uid}", response_model=Case)
async def get_case(case_uid: str, user: dict = Depends(get_current_user)):
    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Case file not found.")
    return doc


@api_router.post("/cases", response_model=Case)
async def create_case(body: CaseCreate, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    if body.division not in DIVISIONS:
        raise HTTPException(status_code=400, detail="Invalid division selected.")
    if body.priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid priority selected.")
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
        notes=[TimelineNote(
            note=f"Case file logged by {user['username']} — awaiting command review.",
            author=user["username"],
            kind="system",
            created_at=ts,
        )],
        created_by=user["username"],
        created_at=ts,
        updated_at=ts,
    )
    await db.cases.insert_one(case.model_dump())
    background_tasks.add_task(notify_discord, case.model_dump())
    return case


@api_router.put("/cases/{case_uid}", response_model=Case)
async def update_case(case_uid: str, body: CaseUpdate, user: dict = Depends(get_current_user)):
    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Case file not found.")

    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    # Only admins may change the status directly.
    if "status" in updates:
        if user["role"] != "admin":
            updates.pop("status")
        elif updates["status"] not in STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status.")
    if "division" in updates and updates["division"] not in DIVISIONS:
        raise HTTPException(status_code=400, detail="Invalid division selected.")
    if "priority" in updates and updates["priority"] not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid priority selected.")

    updates["updated_at"] = now_iso()
    await db.cases.update_one({"id": case_uid}, {"$set": updates})
    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0})
    return doc


@api_router.post("/cases/{case_uid}/notes", response_model=Case)
async def add_note(case_uid: str, body: NoteCreate, user: dict = Depends(get_current_user)):
    note_text = body.note.strip()
    if not note_text:
        raise HTTPException(status_code=400, detail="Note cannot be empty.")
    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Case file not found.")
    ts = now_iso()
    entry = TimelineNote(note=note_text, author=user["username"], kind="note", created_at=ts)
    await db.cases.update_one(
        {"id": case_uid},
        {"$push": {"notes": entry.model_dump()}, "$set": {"updated_at": ts}},
    )
    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0})
    return doc


@api_router.post("/cases/{case_uid}/approve", response_model=Case)
async def approve_case(case_uid: str, user: dict = Depends(require_admin)):
    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Case file not found.")
    ts = now_iso()
    entry = TimelineNote(
        note=f"Case approved and opened by {user['username']}.",
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
            "$push": {"notes": entry.model_dump()},
        },
    )
    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0})
    return doc


@api_router.delete("/cases/{case_uid}")
async def delete_case(case_uid: str, user: dict = Depends(require_admin)):
    result = await db.cases.delete_one({"id": case_uid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Case file not found.")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------
SEED_CASES = [
    {
        "name": "Operation Viper",
        "lead_investigator": "Det. Sgt. J. Williams",
        "division": "Strike Force Raptor",
        "status": "opened",
        "synopsis": "Ongoing surveillance of an outlaw motorcycle gang suspected of firearms trafficking across the inner-west corridor.",
        "discord_url": "https://discord.com/channels/000000000000000000/000000000000000001",
        "priority": "high-risk",
    },
    {
        "name": "Operation Harbour Watch",
        "lead_investigator": "Det. Snr Cst. A. Nguyen",
        "division": "Organised Crime Squad",
        "status": "opened",
        "synopsis": "Investigation into a money-laundering network operating through Sydney harbourside nightclubs.",
        "discord_url": "https://discord.com/channels/000000000000000000/000000000000000002",
        "priority": "urgent",
    },
    {
        "name": "Operation Ironbark",
        "lead_investigator": "Det. Sgt. M. Warrant",
        "division": "Drugs & Firearms Squad",
        "status": "pending",
        "synopsis": "Fresh intelligence report regarding a suspected commercial-quantity drug supply ring in the CBD. Awaiting command review.",
        "discord_url": "https://discord.com/channels/000000000000000000/000000000000000003",
        "priority": "urgent",
    },
    {
        "name": "Operation Southern Cross",
        "lead_investigator": "Det. Insp. R. Patel",
        "division": "Organised Crime Squad",
        "status": "closed",
        "synopsis": "Concluded joint operation resulting in the dismantling of an extortion syndicate. File archived.",
        "discord_url": "https://discord.com/channels/000000000000000000/000000000000000004",
        "priority": "routine",
    },
]


async def seed_cases():
    if await db.cases.count_documents({}) > 0:
        return
    year = datetime.now(timezone.utc).year
    for i, c in enumerate(SEED_CASES, start=1):
        ts = now_iso()
        notes = [TimelineNote(
            note="Case file logged by admin.",
            author="admin",
            kind="system",
            created_at=ts,
        )]
        approved_by = "admin" if c["status"] in ("opened", "closed") else None
        approved_at = ts if approved_by else None
        if approved_by:
            notes.append(TimelineNote(
                note="Case approved and opened by admin.",
                author="admin",
                kind="system",
                created_at=ts,
            ))
        doc = Case(
            case_id=f"SCC-{year}-{i:03d}",
            name=c["name"],
            lead_investigator=c["lead_investigator"],
            division=c["division"],
            synopsis=c["synopsis"],
            discord_url=c["discord_url"],
            status=c["status"],
            priority=c["priority"],
            notes=notes,
            approved_by=approved_by,
            approved_at=approved_at,
            created_by="admin",
            created_at=ts,
            updated_at=ts,
        )
        await db.cases.insert_one(doc.model_dump())
    logger.info("Seeded initial case files.")


@app.on_event("startup")
async def startup():
 
 pass


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
