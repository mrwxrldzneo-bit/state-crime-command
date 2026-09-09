from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import asyncio
import json
import re
from urllib.parse import quote
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import jwt
import httpx
import discord
from discord import app_commands
from fastapi import (
    FastAPI,
    APIRouter,
    HTTPException,
    Depends,
    Query,
    BackgroundTasks,
    Header,
    Request,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import Response
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from bson import ObjectId
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
evidence_fs = AsyncIOMotorGridFSBucket(db, bucket_name="scc_evidence")

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

DISCORD_BOT_TOKEN = os.environ.get(
    "DISCORD_BOT_TOKEN",
    "",
).strip()

DISCORD_PUBLIC_KEY = os.environ.get(
    "DISCORD_PUBLIC_KEY",
    "",
).strip()

DISCORD_EVENT_SECRET = os.environ.get(
    "DISCORD_EVENT_SECRET",
    "",
).strip()

FRONTEND_URL = os.environ.get(
    "FRONTEND_URL",
    "https://scc-dashboard.onrender.com",
).strip().rstrip("/")

PRIORITY_COLORS = {
    "routine": 0x41597E,
    "urgent": 0xD4B25A,
    "high-risk": 0xC0392B,
}

# Discord role mentions are environment-driven because SCC Systems is a new guild.
# Example: DISCORD_PING_ROLE_IDS=123456789012345678,234567890123456789
DISCORD_PING_ROLE_IDS = [
    role_id.strip()
    for role_id in os.environ.get("DISCORD_PING_ROLE_IDS", "").split(",")
    if role_id.strip()
]

SCC_COMMAND_ROLE_ID = os.environ.get(
    "SCC_COMMAND_ROLE_ID",
    "",
).strip()

# Dedicated SCC Systems Discord configuration.
# Environment variables can override these defaults in local/Render deployments.
DISCORD_GUILD_ID = os.environ.get(
    "DISCORD_GUILD_ID",
    "1547009727546789918",
).strip()

DISCORD_SUPPORT_CHANNEL_ID = os.environ.get(
    "DISCORD_SUPPORT_CHANNEL_ID",
    os.environ.get(
        "DISCORD_SUPPORT_FORUM_CHANNEL_ID",
        "1547014902118613052",
    ),
).strip()


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

CASE_FOOTER_IMAGE_URL = (
    "https://i.postimg.cc/2S368f7w/"
    "Screenshot-2026-09-08-at-6-28-15-AM.png"
)


# ---------------------------------------------------------------------------
# Discord helpers
# ---------------------------------------------------------------------------

async def get_discord_webhook_channel():
    """Return (channel_id, channel_type) for the configured Discord webhook."""
    if not DISCORD_WEBHOOK_URL:
        return "", None

    try:
        async with httpx.AsyncClient(timeout=8) as hc:
            response = await hc.get(DISCORD_WEBHOOK_URL)

        if not response.is_success:
            logger.warning(
                "Discord webhook lookup failed: HTTP %s — %s",
                response.status_code,
                response.text[:300],
            )
            return "", None

        data = response.json()
        channel_id = str(data.get("channel_id") or "").strip()

        if not channel_id or not DISCORD_BOT_TOKEN:
            return channel_id, None

        headers = {
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        }

        async with httpx.AsyncClient(timeout=8) as hc:
            channel_response = await hc.get(
                f"https://discord.com/api/v10/channels/{channel_id}",
                headers=headers,
            )

        if not channel_response.is_success:
            return channel_id, None

        channel_data = channel_response.json()
        return channel_id, channel_data.get("type")
    except Exception as exc:
        logger.warning("Discord webhook/channel lookup failed: %s", exc)
        return "", None


async def execute_discord_webhook(
    payload: dict,
    *,
    thread_name: str = "",
    thread_id: str = "",
    attachments: Optional[List[tuple]] = None,
):
    """Execute the configured webhook, supporting forum-thread creation."""
    if not DISCORD_WEBHOOK_URL:
        logger.warning("DISCORD_WEBHOOK_URL is not configured.")
        return None

    base_url = DISCORD_WEBHOOK_URL
    separator = "&" if "?" in base_url else "?"
    query = ["wait=true"]

    if thread_id:
        query.append(f"thread_id={quote(str(thread_id), safe='')}")
    elif thread_name:
        query.append(f"thread_name={quote(thread_name[:100], safe='')}")

    url = f"{base_url}{separator}{'&'.join(query)}"

    last_error = None

    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=20) as hc:
                if attachments:
                    files = {
                        f"files[{index}]": (
                            filename,
                            file_bytes,
                            content_type,
                        )
                        for index, (
                            filename,
                            file_bytes,
                            content_type,
                        ) in enumerate(attachments)
                    }
                    response = await hc.post(
                        url,
                        data={
                            "payload_json": json.dumps(payload)
                        },
                        files=files,
                    )
                else:
                    response = await hc.post(
                        url,
                        json=payload,
                    )

            if response.is_success:
                try:
                    return response.json()
                except Exception:
                    return {}

            last_error = (
                f"HTTP {response.status_code} — {response.text[:500]}"
            )

            # If thread_name was rejected because the webhook is a normal
            # text-channel webhook, retry once without thread_name.
            if thread_name and response.status_code in (400, 404):
                fallback_url = (
                    f"{base_url}"
                    f"{'&' if '?' in base_url else '?'}wait=true"
                )

                async with httpx.AsyncClient(timeout=20) as hc:
                    if attachments:
                        files = {
                            f"files[{index}]": (
                                filename,
                                file_bytes,
                                content_type,
                            )
                            for index, (
                                filename,
                                file_bytes,
                                content_type,
                            ) in enumerate(attachments)
                        }
                        fallback = await hc.post(
                            fallback_url,
                            data={
                                "payload_json": json.dumps(payload)
                            },
                            files=files,
                        )
                    else:
                        fallback = await hc.post(
                            fallback_url,
                            json=payload,
                        )

                if fallback.is_success:
                    try:
                        return fallback.json()
                    except Exception:
                        return {}

                last_error = (
                    f"HTTP {fallback.status_code} — {fallback.text[:500]}"
                )

        except Exception as exc:
            last_error = str(exc)

        if attempt == 0:
            continue

    logger.warning(
        "Discord webhook delivery failed: %s",
        last_error or "unknown error",
    )
    return None


async def resolve_support_forum_channel_id(case: dict) -> str:
    """
    Resolve the Discord parent channel used for SCC Live Support.

    Preferred environment variable:
      DISCORD_SUPPORT_CHANNEL_ID

    The configured parent may be a normal text channel or a Forum channel.
    """
    if DISCORD_SUPPORT_CHANNEL_ID:
        return DISCORD_SUPPORT_CHANNEL_ID

    if not DISCORD_BOT_TOKEN:
        return ""

    return ""


async def get_discord_channel_details(channel_id: str):
    if not channel_id or not DISCORD_BOT_TOKEN:
        return {}

    headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as hc:
            response = await hc.get(
                f"https://discord.com/api/v10/channels/{channel_id}",
                headers=headers,
            )

        if response.is_success:
            return response.json()
    except Exception as exc:
        logger.warning(
            "Discord channel detail lookup failed for %s: %s",
            channel_id,
            exc,
        )

    return {}


async def build_discord_thread_url(thread_id: str, guild_id: str = "") -> str:
    thread_id = str(thread_id or "").strip()
    guild_id = str(guild_id or "").strip()

    if not thread_id:
        return ""

    if not guild_id:
        details = await get_discord_channel_details(thread_id)
        guild_id = str(details.get("guild_id") or "").strip()

    if not guild_id:
        guild_id = DISCORD_GUILD_ID

    if not guild_id:
        return ""

    return f"https://discord.com/channels/{guild_id}/{thread_id}"



def build_support_control_payload(
    case: dict,
    session_id: str,
    *,
    status: str = "active",
    ended_by: str = "",
    ended_at: str = "",
):
    status_key = str(status or "active").lower()

    if status_key == "ending":
        status_text = "ENDING"
        color = 0xD4B25A
        description = (
            "Command has requested termination of this Live Support session. "
            "The attached case thread will close after the five-second countdown."
        )
    elif status_key in {"ended", "closed"}:
        status_text = "CLOSED"
        color = 0x6B2929
        description = (
            "This Live Support session has been closed. "
            "The case transcript remains retained by SCC."
        )
    else:
        status_text = "ACTIVE"
        color = 0x2F8F5B
        description = (
            "A State Crime Command investigator has requested live assistance. "
            "Use **Reply** to respond without cluttering this channel."
        )

    priority = str(case.get("priority") or "routine")
    priority_text = {
        "routine": "Routine",
        "urgent": "Urgent",
        "high-risk": "High-Risk",
    }.get(priority, priority.title())

    fields = [
        {"name": "CASE ID", "value": f"`{case.get('case_id', '—')}`", "inline": True},
        {"name": "OPERATION", "value": case.get("name", "Untitled"), "inline": True},
        {"name": "STATUS", "value": status_text, "inline": True},
        {"name": "LEAD INVESTIGATOR", "value": case.get("lead_investigator", "—"), "inline": True},
        {"name": "DIVISION", "value": case.get("division", "—"), "inline": True},
        {"name": "PRIORITY", "value": priority_text, "inline": True},
    ]

    if ended_by:
        fields.append({"name": "ENDED BY", "value": ended_by, "inline": True})
    if ended_at:
        fields.append({"name": "ENDED AT", "value": ended_at, "inline": True})

    embed = {
        "author": {"name": "NSWPF · STATE CRIME COMMAND"},
        "title": "LIVE SUPPORT CONTROL",
        "description": description,
        "color": color,
        "fields": fields,
        "thumbnail": {"url": DISCORD_FOOTER_ICON_URL},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    components = []
    if status_key == "active":
        components = [{
            "type": 1,
            "components": [
                {
                    "type": 2,
                    "style": 1,
                    "label": "Reply",
                    "custom_id": f"scc_support_reply:{session_id}",
                },
                {
                    "type": 2,
                    "style": 4,
                    "label": "End Support",
                    "custom_id": f"scc_support_end:{session_id}",
                },
            ],
        }]
    elif status_key == "ending":
        components = [{
            "type": 1,
            "components": [{
                "type": 2,
                "style": 2,
                "label": "Ending…",
                "custom_id": f"scc_support_ending:{session_id}",
                "disabled": True,
            }],
        }]

    return {
        "embeds": [embed],
        "components": components,
        "allowed_mentions": {"parse": []},
    }


async def post_discord_thread_message(thread_id: str, content: str):
    thread_id = str(thread_id or "").strip()
    if not thread_id or not DISCORD_BOT_TOKEN:
        return None

    headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as hc:
            response = await hc.post(
                f"https://discord.com/api/v10/channels/{thread_id}/messages",
                json={
                    "content": str(content or "")[:2000],
                    "allowed_mentions": {"parse": []},
                },
                headers=headers,
            )
        if response.is_success:
            return response.json()
        logger.warning(
            "Discord thread message failed: HTTP %s — %s",
            response.status_code,
            response.text[:400],
        )
    except Exception as exc:
        logger.warning("Discord thread message failed: %s", exc)

    return None


async def edit_support_control_message(
    case: dict,
    *,
    status: str,
    ended_by: str = "",
    ended_at: str = "",
):
    parent_id = str(case.get("help_discord_parent_channel_id") or "").strip()
    message_id = str(case.get("help_discord_message_id") or "").strip()
    session_id = str(case.get("help_session_id") or "").strip()

    if not parent_id or not message_id or not session_id or not DISCORD_BOT_TOKEN:
        return False

    headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as hc:
            response = await hc.patch(
                f"https://discord.com/api/v10/channels/{parent_id}/messages/{message_id}",
                json=build_support_control_payload(
                    case,
                    session_id,
                    status=status,
                    ended_by=ended_by,
                    ended_at=ended_at,
                ),
                headers=headers,
            )
        return response.is_success
    except Exception as exc:
        logger.warning("Discord support control update failed: %s", exc)
        return False


async def begin_support_end(case: dict, ended_by: str):
    if not case or not case.get("help_session_id"):
        return None
    if not case.get("help_session_active"):
        return case.get("help_ending_at")

    ending_at = (
        datetime.now(timezone.utc) + timedelta(seconds=5)
    ).isoformat()

    await db.cases.update_one(
        {"id": case["id"]},
        {"$set": {
            "help_discord_status": "ending",
            "help_ending_at": ending_at,
            "help_ending_by": ended_by,
            "updated_at": now_iso(),
        }},
    )

    await db.tactical_sessions.update_one(
        {"id": case["help_session_id"], "active": True},
        {"$set": {"ending_at": ending_at, "ending_by": ended_by}},
    )

    refreshed = await db.cases.find_one({"id": case["id"]}, {"_id": 0})
    thread_id = str(case.get("help_discord_channel_id") or "").strip()

    if thread_id:
        await post_discord_thread_message(
            thread_id,
            (
                "**LIVE SUPPORT END REQUESTED**\n"
                f"Requested by **{ended_by}**.\n"
                "Session will close in **5 seconds**."
            ),
        )

    if refreshed:
        await edit_support_control_message(refreshed, status="ending")

    return ending_at


async def finalize_support_end(
    case_id: str,
    session_id: str,
    ended_by: str,
    ending_at: str,
):
    try:
        target = datetime.fromisoformat(str(ending_at).replace("Z", "+00:00"))
    except Exception:
        target = datetime.now(timezone.utc) + timedelta(seconds=5)

    delay = max(0.0, (target - datetime.now(timezone.utc)).total_seconds())
    if delay:
        await asyncio.sleep(delay)

    case = await db.cases.find_one({"id": case_id}, {"_id": 0})
    if not case or not case.get("help_session_active"):
        return
    if str(case.get("help_session_id") or "") != str(session_id):
        return
    if str(case.get("help_ending_at") or "") != str(ending_at):
        return

    session = await db.tactical_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        return

    ts = now_iso()
    messages = session.get("messages", [])
    transcript_lines = [
        (
            f"[{m.get('created_at', '—')}] "
            f"{m.get('username', 'Unknown')} "
            f"({m.get('officer_id', '—')}): "
            f"{m.get('message', '')}"
        )
        for m in messages
    ]
    transcript = "\n".join(transcript_lines)[:12000] or "No messages recorded."

    entry = TimelineNote(
        note=(
            f"Live support session ended by {ended_by}."
            f"\n\nTranscript:\n{transcript}"
        ),
        author=ended_by,
        kind="support",
        created_at=ts,
    )

    await db.tactical_sessions.update_one(
        {"id": session_id},
        {"$set": {
            "active": False,
            "cleared_by": ended_by,
            "cleared_at": ts,
            "ended_at": ts,
        }},
    )

    thread_id = str(case.get("help_discord_channel_id") or "").strip()
    if thread_id and DISCORD_BOT_TOKEN:
        await post_discord_thread_message(
            thread_id,
            f"**LIVE SUPPORT CLOSED**\nEnded by **{ended_by}**.",
        )

        headers = {
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=10) as hc:
                response = await hc.patch(
                    f"https://discord.com/api/v10/channels/{thread_id}",
                    json={"archived": True, "locked": True},
                    headers=headers,
                )
                if not response.is_success:
                    await hc.patch(
                        f"https://discord.com/api/v10/channels/{thread_id}",
                        json={"archived": True},
                        headers=headers,
                    )
        except Exception as exc:
            logger.warning(
                "Discord support thread archive failed for %s: %s",
                thread_id,
                exc,
            )

    await db.cases.update_one(
        {"id": case_id},
        {
            "$set": {
                "help_session_active": False,
                "help_discord_status": "ended",
                "help_ending_at": None,
                "help_ending_by": ended_by,
                "updated_at": ts,
            },
            "$push": {"notes": entry.model_dump()},
        },
    )

    closed_case = await db.cases.find_one({"id": case_id}, {"_id": 0})
    if closed_case:
        await edit_support_control_message(
            closed_case,
            status="closed",
            ended_by=ended_by,
            ended_at=ts,
        )


async def begin_and_finalize_support_end(case_id: str, ended_by: str):
    case = await db.cases.find_one({"id": case_id}, {"_id": 0})
    if not case:
        return
    ending_at = await begin_support_end(case, ended_by)
    if ending_at:
        await finalize_support_end(
            case["id"],
            case["help_session_id"],
            ended_by,
            ending_at,
        )



async def end_support_from_discord_interaction(
    session_id: str,
    ended_by: str,
):
    case = await db.cases.find_one(
        {
            "help_session_id": session_id,
            "help_session_active": True,
        },
        {"_id": 0},
    )

    if not case:
        logger.info(
            "Discord End Support ignored; session %s is no longer active.",
            session_id,
        )
        return

    existing_ending_at = str(
        case.get("help_ending_at") or ""
    ).strip()

    if existing_ending_at:
        logger.info(
            "Discord End Support ignored; session %s is already ending.",
            session_id,
        )
        return

    await begin_and_finalize_support_end(
        case["id"],
        ended_by,
    )


async def reply_from_discord_interaction(
    session_id: str,
    author_name: str,
    author_id: str,
    reply_text: str,
):
    case = await db.cases.find_one(
        {
            "help_session_id": session_id,
            "help_session_active": True,
        },
        {"_id": 0},
    )

    if not case:
        logger.info(
            "Discord Reply ignored; session %s is no longer active.",
            session_id,
        )
        return

    await deliver_discord_modal_reply(
        case["id"],
        session_id,
        author_name,
        author_id,
        reply_text,
    )


async def deliver_discord_modal_reply(
    case_id: str,
    session_id: str,
    author_name: str,
    author_id: str,
    reply_text: str,
):
    case = await db.cases.find_one(
        {
            "id": case_id,
            "help_session_id": session_id,
            "help_session_active": True,
        },
        {"_id": 0},
    )
    if not case:
        return

    thread_id = str(case.get("help_discord_channel_id") or "").strip()
    if not thread_id:
        return

    sent = await post_discord_thread_message(
        thread_id,
        f"**Support Agent**\n{reply_text[:1800]}",
    )
    discord_message_id = str((sent or {}).get("id") or "").strip()

    incoming = {
        "id": str(uuid.uuid4()),
        "username": "Support Agent",
        "officer_id": author_id,
        "message": reply_text[:2000],
        "created_at": now_iso(),
        "source": "discord",
        "discord_message_id": discord_message_id or None,
        "discord_channel_id": thread_id,
    }

    await db.tactical_sessions.update_one(
        {"id": session_id, "active": True},
        {"$push": {"messages": incoming}},
    )


def verify_discord_interaction_signature(
    raw_body: bytes,
    signature: str,
    timestamp: str,
) -> bool:
    if not DISCORD_PUBLIC_KEY or not signature or not timestamp:
        return False

    message = timestamp.encode("utf-8") + raw_body

    try:
        from nacl.signing import VerifyKey
        from nacl.exceptions import BadSignatureError
        try:
            VerifyKey(bytes.fromhex(DISCORD_PUBLIC_KEY)).verify(
                message,
                bytes.fromhex(signature),
            )
            return True
        except (BadSignatureError, ValueError, TypeError):
            return False
    except ImportError:
        pass

    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.exceptions import InvalidSignature
        try:
            Ed25519PublicKey.from_public_bytes(
                bytes.fromhex(DISCORD_PUBLIC_KEY)
            ).verify(
                bytes.fromhex(signature),
                message,
            )
            return True
        except (InvalidSignature, ValueError, TypeError):
            return False
    except ImportError:
        logger.error("Discord Interactions requires PyNaCl or cryptography.")
        return False


async def create_support_forum_post(
    case: dict,
    user: dict,
    request: dict,
):
    """
    Create one case-locked Discord support thread.

    If DISCORD_SUPPORT_CHANNEL_ID points to a normal text channel, create a
    public thread under that channel and send the support request into it.

    If it points to a Forum channel, create a normal Forum post.
    """
    priority = case.get("priority", "routine")
    priority_label = {
        "routine": "Routine",
        "urgent": "Urgent",
        "high-risk": "High-Risk",
    }.get(priority, str(priority).title())

    officer_id = (request.get("officer_id") or "").strip() or "Not provided"
    username = (user.get("username") or "Unknown").strip()
    message = (request.get("message") or "").strip()

    join_url = (
        f"{FRONTEND_URL}/cases"
        f"?case={case.get('id', '')}&support=1"
    )

    thread_name = (
        f"SUPPORT • {case.get('case_id', 'SCC')} • "
        f"{case.get('name', 'Case')}"
    )[:100]

    embed = {
        "author": {"name": "NSWPF · State Crime Command"},
        "title": (
            f"LIVE SUPPORT CHAT — "
            f"{case.get('case_id', 'Unknown Case')}"
        ),
        "description": (
            "An officer has requested assistance through the "
            "**SCC Case Tracker**.\n\n"
            f"👉 **[ 💬 JOIN LIVE SUPPORT CHAT ]({join_url})**\n\n"
            f"**Request:**\n{message[:1500]}"
        ),
        "color": 0xD4B25A,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "thumbnail": {"url": DISCORD_FOOTER_ICON_URL},
        "footer": {
            "text": "State Crime Command · Live Support Chat",
            "icon_url": DISCORD_FOOTER_ICON_URL,
        },
        "fields": [
            {"name": "CASE", "value": case.get("name", "Untitled"), "inline": True},
            {"name": "CASE ID", "value": case.get("case_id", "—"), "inline": True},
            {"name": "PRIORITY", "value": priority_label, "inline": True},
            {"name": "DIVISION", "value": case.get("division", "—"), "inline": True},
            {
                "name": "LEAD INVESTIGATOR",
                "value": case.get("lead_investigator", "—"),
                "inline": True,
            },
            {"name": "OFFICER ID", "value": officer_id, "inline": True},
            {"name": "ACCOUNT", "value": username, "inline": True},
        ],
    }

    command_mention = (
        f"<@&{SCC_COMMAND_ROLE_ID}>"
        if SCC_COMMAND_ROLE_ID
        else ""
    )

    content = (
        f"{command_mention}\n"
        "**SCC LIVE SUPPORT REQUEST — COMMAND RESPONSE REQUIRED.**"
    ).strip()

    allowed_mentions = {
        "parse": [],
        "roles": [SCC_COMMAND_ROLE_ID] if SCC_COMMAND_ROLE_ID else [],
    }

    parent_id = await resolve_support_forum_channel_id(case)

    if not parent_id:
        return {
            "error": (
                "No Discord support channel is configured. "
                "Check DISCORD_SUPPORT_CHANNEL_ID."
            )
        }

    if not DISCORD_BOT_TOKEN:
        return {
            "error": "DISCORD_BOT_TOKEN is missing from the backend environment."
        }

    headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json",
    }

    # Read the exact configured parent so we know whether it is text or Forum.
    try:
        async with httpx.AsyncClient(timeout=12) as hc:
            channel_response = await hc.get(
                f"https://discord.com/api/v10/channels/{parent_id}",
                headers=headers,
            )
    except Exception as exc:
        logger.warning("Discord support channel preflight failed: %s", exc)
        return {"error": f"Discord support channel preflight failed: {exc}"}

    if not channel_response.is_success:
        logger.warning(
            "Discord support channel preflight failed: HTTP %s — %s",
            channel_response.status_code,
            channel_response.text[:500],
        )
        return {
            "error": (
                f"Discord support channel preflight failed "
                f"(HTTP {channel_response.status_code}): "
                f"{channel_response.text[:350]}"
            )
        }

    channel_data = channel_response.json()
    channel_type = channel_data.get("type")

    # Forum channel.
    if channel_type == 15:
        payload = {
            "name": thread_name,
            "auto_archive_duration": 1440,
            "message": {
                "content": content,
                "embeds": [embed],
                "allowed_mentions": allowed_mentions,
            },
        }

        flags = int(channel_data.get("flags") or 0)
        require_tag = bool(flags & 16)
        available_tags = channel_data.get("available_tags") or []

        if require_tag:
            first_tag_id = next(
                (
                    str(tag.get("id") or "").strip()
                    for tag in available_tags
                    if str(tag.get("id") or "").strip()
                ),
                "",
            )
            if not first_tag_id:
                return {
                    "error": (
                        "The Discord Forum requires a tag but no usable "
                        "Forum tag is configured."
                    )
                }
            payload["applied_tags"] = [first_tag_id]

        try:
            async with httpx.AsyncClient(timeout=15) as hc:
                response = await hc.post(
                    f"https://discord.com/api/v10/channels/{parent_id}/threads",
                    json=payload,
                    headers=headers,
                )
        except Exception as exc:
            return {"error": f"Discord Forum post creation failed: {exc}"}

        if not response.is_success:
            return {
                "error": (
                    f"Discord Forum post creation failed "
                    f"(HTTP {response.status_code}): "
                    f"{response.text[:350]}"
                )
            }

        data = response.json()
        thread_id = str(data.get("id") or "").strip()
        guild_id = str(data.get("guild_id") or DISCORD_GUILD_ID).strip()
        thread_url = await build_discord_thread_url(thread_id, guild_id)

        return {
            "thread_id": thread_id,
            "message_id": str(
                ((data.get("message") or {}).get("id")) or ""
            ),
            "guild_id": guild_id,
            "thread_url": thread_url,
            "error": "",
        }

    # Normal guild text channel.
    # One polished control message in the parent channel; all actual chat is
    # placed inside a public thread attached directly to that message.
    if channel_type == 0:
        session_id = str(request.get("session_id") or "").strip()
        if not session_id:
            return {"error": "Support session ID is missing."}

        try:
            async with httpx.AsyncClient(timeout=15) as hc:
                control_response = await hc.post(
                    f"https://discord.com/api/v10/channels/{parent_id}/messages",
                    json=build_support_control_payload(
                        case,
                        session_id,
                        status="active",
                    ),
                    headers=headers,
                )
        except Exception as exc:
            return {"error": f"Discord support control message failed: {exc}"}

        if not control_response.is_success:
            return {
                "error": (
                    "Discord support control message failed "
                    f"(HTTP {control_response.status_code}): "
                    f"{control_response.text[:350]}"
                )
            }

        control_data = control_response.json()
        control_message_id = str(control_data.get("id") or "").strip()
        if not control_message_id:
            return {"error": "Discord created no support control message ID."}

        try:
            async with httpx.AsyncClient(timeout=15) as hc:
                thread_response = await hc.post(
                    (
                        "https://discord.com/api/v10/channels/"
                        f"{parent_id}/messages/{control_message_id}/threads"
                    ),
                    json={
                        "name": thread_name,
                        "auto_archive_duration": 1440,
                    },
                    headers=headers,
                )
        except Exception as exc:
            return {
                "error": (
                    "Discord attached support thread creation failed: "
                    f"{exc}"
                )
            }

        if not thread_response.is_success:
            return {
                "error": (
                    "Discord attached support thread creation failed "
                    f"(HTTP {thread_response.status_code}): "
                    f"{thread_response.text[:350]}"
                )
            }

        thread_data = thread_response.json()
        thread_id = str(thread_data.get("id") or "").strip()
        guild_id = str(
            thread_data.get("guild_id")
            or channel_data.get("guild_id")
            or DISCORD_GUILD_ID
        ).strip()

        if not thread_id:
            return {"error": "Discord created no attached support thread ID."}

        starter_data = await post_discord_thread_message(
            thread_id,
            f"**{username} [{officer_id}]**\n{message[:1800]}",
        )

        if starter_data is None:
            return {
                "error": (
                    "Discord created the attached support thread, "
                    "but the initial chat message could not be posted."
                )
            }

        return {
            "thread_id": thread_id,
            "message_id": control_message_id,
            "parent_channel_id": parent_id,
            "starter_message_id": str(starter_data.get("id") or ""),
            "guild_id": guild_id,
            "thread_url": await build_discord_thread_url(thread_id, guild_id),
            "error": "",
        }

    return {
        "error": (
            f"Configured support channel {parent_id} has unsupported "
            f"Discord channel type {channel_type}. Use a normal text "
            f"channel or Forum channel."
        )
    }

async def sync_discord_thread_replies(
    case: dict,
    session: dict,
):
    """
    Pull human replies from the Discord forum/thread into the website session.

    This removes the need for a separate websocket/gateway bridge: the website
    already polls /help/session every three seconds, and this endpoint fetches
    the latest Discord thread messages on demand.
    """
    thread_id = str(
        case.get("help_discord_channel_id")
        or ""
    ).strip()

    if (
        not thread_id
        or not DISCORD_BOT_TOKEN
        or not session
    ):
        return session

    headers = {
        "Authorization": (
            f"Bot {DISCORD_BOT_TOKEN}"
        ),
    }

    try:
        async with httpx.AsyncClient(
            timeout=8
        ) as hc:
            response = await hc.get(
                (
                    "https://discord.com/api/v10/"
                    f"channels/{thread_id}/messages"
                    "?limit=50"
                ),
                headers=headers,
            )

        if not response.is_success:
            logger.warning(
                "Discord support reply polling failed: "
                "HTTP %s — %s",
                response.status_code,
                response.text[:300],
            )
            return session

        discord_messages = response.json()
    except Exception as exc:
        logger.warning(
            "Discord support reply polling failed: %s",
            exc,
        )
        return session

    existing_discord_ids = {
        str(message.get("discord_message_id"))
        for message in session.get(
            "messages",
            [],
        )
        if message.get("discord_message_id")
    }

    additions = []

    # Discord returns newest-first. Reverse so chat order remains chronological.
    for item in reversed(discord_messages):
        message_id = str(
            item.get("id") or ""
        ).strip()

        if (
            not message_id
            or message_id in existing_discord_ids
        ):
            continue

        author = item.get("author") or {}

        # Ignore bot/webhook messages. Website-originated messages are sent by
        # the SCC bot and already exist locally in the chat session.
        if (
            author.get("bot")
            or item.get("webhook_id")
        ):
            continue

        content = str(
            item.get("content") or ""
        ).strip()

        if not content:
            continue

        display_name = "Support Agent"

        additions.append({
            "id": str(uuid.uuid4()),
            "username": display_name,
            "officer_id": str(
                author.get("id") or ""
            ),
            "message": content[:2000],
            "created_at": (
                item.get("timestamp")
                or now_iso()
            ),
            "source": "discord",
            "discord_message_id": message_id,
            "discord_channel_id": thread_id,
        })

        existing_discord_ids.add(
            message_id
        )

    if additions:
        await db.tactical_sessions.update_one(
            {
                "id": session["id"],
                "active": True,
            },
            {
                "$push": {
                    "messages": {
                        "$each": additions
                    }
                }
            },
        )

        session = await db.tactical_sessions.find_one(
            {
                "id": session["id"]
            },
            {
                "_id": 0
            },
        )

    return session


async def notify_help_discord(
    case: dict,
    user: dict,
    request: dict,
    session_id: str,
):
    """Create a case-locked Discord forum/thread for live support."""
    result = await create_support_forum_post(
        case,
        user,
        request,
    )

    if not result:
        logger.warning(
            "Discord live support forum/thread was not created for %s.",
            case.get("case_id", "unknown"),
        )
        return

    thread_id = str(
        result.get("thread_id") or ""
    ).strip()
    message_id = str(
        result.get("message_id") or ""
    ).strip()
    thread_url = str(
        result.get("thread_url") or ""
    ).strip()

    if not thread_id:
        logger.warning(
            "Discord live support response did not contain a thread/channel id."
        )
        return

    await db.cases.update_one(
        {"id": case.get("id")},
        {
            "$set": {
                "help_discord_message_id": message_id or None,
                "help_discord_channel_id": thread_id,
                "help_session_id": session_id,
                "help_session_active": True,
                "help_discord_status": "connected",
                "help_discord_thread_url": thread_url or None,
                "updated_at": now_iso(),
            }
        },
    )

    logger.info(
        "Discord live support forum/thread %s linked to %s.",
        thread_id,
        case.get("case_id", "unknown"),
    )


async def notify_discord(case: dict):
    """Send the new-case alert as exactly three modular Discord embeds."""

    if not DISCORD_WEBHOOK_URL:
        logger.warning(
            "Discord webhook is not configured; case notification was not sent."
        )
        return

    mentions = "@everyone"
    priority = case.get("priority", "routine")
    priority_label = {
        "routine": "Routine",
        "urgent": "Urgent",
        "high-risk": "High-Risk",
    }.get(priority, str(priority).title())

    synopsis = (case.get("synopsis") or "").strip() or "No synopsis recorded."

    # All three embeds use the case priority colour.
    case_embed_color = PRIORITY_COLORS.get(
        priority,
        PRIORITY_COLORS["routine"],
    )

    # Embed 1 — full-width New Case banner.
    banner_embed = {
        "color": case_embed_color,
        "image": {
            "url": CASE_BANNER_URL,
        },
    }

    # Embed 2 — clean case alert details with the footer artwork
    # attached at the bottom of this same embed.
    case_alert_embed = {
        "color": case_embed_color,
        "title": "CASE ALERT",
        "description": "\u200b" * 80,
        "fields": [
            {
                "name": "CASE ID",
                "value": f"`{case.get('case_id', '—')}`",
                "inline": True,
            },
            {
                "name": "OPERATION",
                "value": case.get("name", "Untitled Case"),
                "inline": True,
            },
            {
                "name": "REQUESTED PRIORITY",
                "value": priority_label.upper(),
                "inline": True,
            },
            {
                "name": "LEAD INVESTIGATOR",
                "value": case.get("lead_investigator", "—"),
                "inline": True,
            },
            {
                "name": "DIVISION",
                "value": case.get("division", "—"),
                "inline": True,
            },
            {
                "name": "STATUS",
                "value": "PENDING COMMAND REVIEW",
                "inline": True,
            },
            {
                "name": "BASIS FOR INVESTIGATION",
                "value": (case.get("request_basis") or synopsis)[:1024],
                "inline": False,
            },
            {
                "name": "INVESTIGATION OBJECTIVE",
                "value": (case.get("investigation_objective") or "Not specified.")[:1024],
                "inline": False,
            },
            {
                "name": "INITIAL SUPPORTING MATERIAL",
                "value": f"{len(case.get('supporting_material') or [])} item(s) submitted",
                "inline": False,
            },
        ],
        "image": {
            "url": "attachment://scc-case-footer.png",
        },
    }

    payload = {
        "content": mentions,
        "embeds": [
            banner_embed,
            case_alert_embed,
        ],
        "allowed_mentions": {
            "parse": ["everyone"],
        },
    }

    thread_name = (
        f"{case.get('case_id', 'SCC')} • "
        f"{case.get('name', 'Case File')}"
    )[:100]

    footer_attachments = []

    try:
        async with httpx.AsyncClient(timeout=15) as hc:
            footer_response = await hc.get(
                CASE_FOOTER_IMAGE_URL,
                follow_redirects=True,
            )

        if footer_response.is_success and footer_response.content:
            footer_content_type = (
                footer_response.headers.get(
                    "content-type",
                    "image/png",
                )
                .split(";")[0]
                .strip()
                or "image/png"
            )

            footer_attachments.append(
                (
                    "scc-case-footer.png",
                    footer_response.content,
                    footer_content_type,
                )
            )
        else:
            logger.warning(
                "SCC footer image fetch failed: HTTP %s",
                footer_response.status_code,
            )
    except Exception as exc:
        logger.warning(
            "SCC footer image fetch failed: %s",
            exc,
        )

    # If the attachment fetch failed, fall back to the remote URL rather
    # than sending a dead attachment:// reference.
    if not footer_attachments:
        case_alert_embed["image"]["url"] = CASE_FOOTER_IMAGE_URL

    data = await execute_discord_webhook(
        payload,
        thread_name=thread_name,
        attachments=footer_attachments or None,
    )

    if data is None:
        logger.warning(
            "Discord new-case alert was not delivered for %s.",
            case.get("case_id", "unknown"),
        )
        return

    message_id = str(
        data.get("id") or ""
    ).strip()
    channel_id = str(
        data.get("channel_id") or ""
    ).strip()

    if message_id or channel_id:
        await db.cases.update_one(
            {"id": case.get("id")},
            {
                "$set": {
                    "discord_message_id": message_id or None,
                    "discord_channel_id": channel_id or None,
                }
            },
        )

    logger.info(
        "Discord new-case alert delivered for %s.",
        case.get("case_id", "unknown"),
    )


async def send_case_review_notification(
    case: dict,
    action: str,
    username: str,
    timestamp: str,
    denial_reason: str = "",
):
    """Reply to the original pending case alert using the Discord bot API."""

    message_id = str(case.get("discord_message_id") or "").strip()
    channel_id = str(case.get("discord_channel_id") or "").strip()

    if not message_id or not channel_id:
        logger.error(
            "Cannot reply to case %s: original Discord message/channel ID is missing.",
            case.get("case_id", "unknown"),
        )
        return

    is_approved = action == "approved"
    if is_approved:
        content = (
            f"This case has been approved and is now open. "
            f"Reviewed by {username}."
        )
    else:
        reason = denial_reason.strip()
        content = (
            "This case has been denied, please review the reason why: "
            f"{reason}"
        )

    # Preferred: bot message into the original case thread/channel.
    if DISCORD_BOT_TOKEN:
        url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
        payload = {
            "content": content[:2000],
            "allowed_mentions": {"parse": []},
        }

        # If the original alert is a normal channel message, this makes the
        # notification a true reply. In a forum thread, a plain thread message
        # is already the correct threaded response.
        if message_id:
            payload["message_reference"] = {
                "message_id": message_id,
                "channel_id": channel_id,
                "fail_if_not_exists": False,
            }

        headers = {
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=10) as hc:
                response = await hc.post(
                    url,
                    json=payload,
                    headers=headers,
                )

            if response.is_success:
                logger.info(
                    "Discord case review reply sent for %s.",
                    case.get("case_id", "unknown"),
                )
                return

            logger.warning(
                "Discord bot case review failed: HTTP %s — %s",
                response.status_code,
                response.text[:500],
            )
        except Exception as exc:
            logger.warning(
                "Discord bot case review failed: %s",
                exc,
            )

    # Reliable fallback: post into the same Discord thread using the webhook.
    webhook_result = await execute_discord_webhook(
        {
            "content": content[:2000],
            "allowed_mentions": {"parse": []},
        },
        thread_id=channel_id,
    )

    if webhook_result is None:
        logger.warning(
            "Discord case review fallback failed for %s.",
            case.get("case_id", "unknown"),
        )
    else:
        logger.info(
            "Discord case review fallback sent for %s.",
            case.get("case_id", "unknown"),
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
    officer_id: str = "",
) -> str:

    payload = {
        "sub": username,
        "role": role,
        "officer_id": officer_id,
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
            "officer_id": payload.get("officer_id", ""),
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
    officer_id: str = ""


class SupportingMaterial(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str = "Other"
    description: str = ""
    reference_url: str = ""


class CaseCreate(BaseModel):
    name: str
    lead_investigator: str
    division: str
    synopsis: str = ""
    discord_url: str = ""
    priority: str = "routine"
    request_basis: str = ""
    known_information: str = ""
    investigation_objective: str = ""
    supporting_material: List[SupportingMaterial] = Field(default_factory=list)


class CaseUpdate(BaseModel):
    name: Optional[str] = None
    lead_investigator: Optional[str] = None
    division: Optional[str] = None
    synopsis: Optional[str] = None
    discord_url: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    request_basis: Optional[str] = None
    known_information: Optional[str] = None
    investigation_objective: Optional[str] = None
    supporting_material: Optional[List[SupportingMaterial]] = None


class HelpRequest(BaseModel):
    message: str
    officer_id: str = ""
    username: str = ""


class DenyRequest(BaseModel):
    denial_reason: str


class ApprovalReviewRequest(BaseModel):
    change_requested: bool = False
    name: Optional[str] = None
    lead_investigator: Optional[str] = None
    division: Optional[str] = None
    priority: Optional[str] = None
    request_basis: Optional[str] = None
    known_information: Optional[str] = None
    investigation_objective: Optional[str] = None


class TacticalMessageCreate(BaseModel):
    message: str


class DiscordReplyEvent(BaseModel):
    message_id: str = ""
    channel_id: str = ""
    thread_id: str = ""
    session_id: str = ""
    case_uid: str = ""
    content: str = ""
    message: str = ""
    author_name: str = ""
    author_display_name: str = ""
    author_username: str = ""
    author_id: str = ""
    author: Optional[dict] = None
    bot: bool = False


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


class InvestigationLogCreate(BaseModel):
    action_taken: str
    information_obtained: str = ""
    outcome_further_action: str = ""
    related_records: str = ""


class PersonnelRequest(BaseModel):
    investigator: str


class CommandRequestCreate(BaseModel):
    request_type: str
    details: str = ""
    requested_value: str = ""


class CommandRequestDecision(BaseModel):
    decision: str
    reason: str = ""


class CommandFlagsUpdate(BaseModel):
    flags: List[str] = Field(default_factory=list)


class CommandNoteCreate(BaseModel):
    note: str


class ClosureRequestCreate(BaseModel):
    outcome_summary: str


class EvidenceRemoveRequest(BaseModel):
    reason: str


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
    requested_priority: str = "routine"

    request_basis: str = ""
    known_information: str = ""
    investigation_objective: str = ""
    supporting_material: List[SupportingMaterial] = Field(default_factory=list)
    request_original: Optional[dict] = None
    case_file: Optional[dict] = None
    workspace_unlocked: bool = False
    investigation_log: List[dict] = Field(default_factory=list)
    evidence: List[dict] = Field(default_factory=list)
    assigned_investigators: List[str] = Field(default_factory=list)
    activity_log: List[dict] = Field(default_factory=list)
    command_requests: List[dict] = Field(default_factory=list)
    command_flags: List[str] = Field(default_factory=list)
    command_notes: List[dict] = Field(default_factory=list)
    closure_request: Optional[dict] = None
    command_adjusted_by: Optional[str] = None
    command_adjusted_at: Optional[str] = None

    notes: List[TimelineNote] = Field(
        default_factory=list
    )

    approved_by: Optional[str] = None
    approved_at: Optional[str] = None

    denied_by: Optional[str] = None
    denied_at: Optional[str] = None

    discord_message_id: Optional[str] = None
    discord_channel_id: Optional[str] = None
    help_discord_message_id: Optional[str] = None
    help_discord_channel_id: Optional[str] = None
    help_discord_parent_channel_id: Optional[str] = None
    help_discord_thread_url: Optional[str] = None
    help_discord_status: Optional[str] = None
    help_discord_error: Optional[str] = None
    help_session_id: Optional[str] = None
    help_session_active: bool = False
    help_ending_at: Optional[str] = None
    help_ending_by: Optional[str] = None
    denial_reason: Optional[str] = None

    created_by: str
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean_case_text(value: str) -> str:
    text = " ".join(str(value or "").strip().split())
    if not text:
        return ""
    text = text[0].upper() + text[1:] if text else text
    if text[-1:] not in ".!?":
        text += "."
    return text


def build_professional_case_summary(case: dict) -> str:
    """Present submitted facts formally without adding new investigative facts."""
    basis = _clean_case_text(
        case.get("request_basis") or case.get("synopsis") or ""
    )
    known = _clean_case_text(case.get("known_information") or "")
    objective = _clean_case_text(case.get("investigation_objective") or "")

    paragraphs = []
    if basis:
        paragraphs.append(
            "This investigation was authorised following command review of the "
            f"submitted grounds. {basis}"
        )
    if known:
        paragraphs.append(
            "At the time of authorisation, the recorded known information was as "
            f"follows: {known}"
        )
    if objective:
        paragraphs.append(
            "The stated investigative objective is recorded as follows: "
            f"{objective}"
        )

    return (
        "\n\n".join(paragraphs)
        or "Investigation authorised following command review."
    )


def build_initial_evidence_register(
    case: dict,
    approved_by: str,
    approved_at: str,
) -> list:
    case_id = str(case.get("case_id") or "SCC").strip()
    suffix = case_id.split("-")[-1] if "-" in case_id else case_id
    evidence = []

    for index, item in enumerate(
        case.get("supporting_material") or [],
        start=1,
    ):
        if hasattr(item, "model_dump"):
            item = item.model_dump()
        item = dict(item or {})
        description = str(item.get("description") or "").strip()
        reference_url = str(item.get("reference_url") or "").strip()

        if not description and not reference_url:
            continue

        evidence.append(
            {
                "evidence_id": f"EVD-{suffix}-{index:03d}",
                "type": str(item.get("type") or "Other").strip() or "Other",
                "description": description,
                "reference_url": reference_url,
                "submitted_by": str(case.get("created_by") or "Unknown"),
                "submitted_at": str(case.get("created_at") or approved_at),
                "registered_at": approved_at,
                "registered_by": approved_by,
                "source": "initial_submission",
            }
        )

    return evidence


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

    normalized_username = body.username.strip().upper()
    normalized_password = body.password.upper()

    account = ACCOUNTS.get(
        normalized_username
    )

    if (
        not account
        or account["password"] != normalized_password
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials. Access denied.",
        )

    token = create_access_token(
        normalized_username,
        account["role"],
        body.officer_id.strip().upper(),
    )

    return {
        "token": token,
        "username": normalized_username,
        "role": account["role"],
        "officer_id": body.officer_id.strip().upper(),
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

    if user.get("role") != "admin":
        for doc in docs:
            doc["command_notes"] = []
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

    if user.get("role") != "admin":
        doc["command_notes"] = []
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
        synopsis=(body.synopsis or body.request_basis),
        discord_url=body.discord_url,
        priority=body.priority,
        requested_priority=body.priority,
        request_basis=(body.request_basis or body.synopsis),
        known_information=body.known_information,
        investigation_objective=body.investigation_objective,
        supporting_material=body.supporting_material,
        request_original={
            "name": body.name,
            "lead_investigator": body.lead_investigator,
            "division": body.division,
            "priority": body.priority,
            "request_basis": (body.request_basis or body.synopsis),
            "known_information": body.known_information,
            "investigation_objective": body.investigation_objective,
            "supporting_material": [
                item.model_dump()
                for item in body.supporting_material
            ],
            "submitted_by": user["username"],
            "submitted_at": ts,
        },
        workspace_unlocked=False,
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

    case_document = case.model_dump()

    await db.cases.insert_one(
        case_document
    )

    background_tasks.add_task(
        notify_discord,
        case_document,
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
            detail="Please describe what assistance is required.",
        )

    # Reuse the case's existing active support session instead of creating
    # duplicate sessions every time the chat is reopened.
    existing_session_id = str(case.get("help_session_id") or "").strip()
    if case.get("help_session_active") and existing_session_id:
        existing_session = await db.tactical_sessions.find_one(
            {"id": existing_session_id, "active": True},
            {"_id": 0},
        )
        if existing_session:
            return {
                "message": "Existing support session restored.",
                "session": existing_session,
                "discord_connected": bool(case.get("help_discord_channel_id")),
                "discord_thread_url": str(
                    case.get("help_discord_thread_url") or ""
                ).strip(),
                "discord_error": str(
                    case.get("help_discord_error") or ""
                ).strip(),
                "reused": True,
            }

    session_id = str(uuid.uuid4())
    session_ts = now_iso()
    session = {
        "id": session_id,
        "case_id": case["id"],
        "case_number": case.get("case_id", ""),
        "created_by": user["username"],
        "officer_id": (
            body.officer_id or user.get("officer_id", "")
        ).strip().upper(),
        "created_at": session_ts,
        "active": True,
        "messages": [{
            "id": str(uuid.uuid4()),
            "username": user["username"],
            "officer_id": (
                body.officer_id or user.get("officer_id", "")
            ).strip().upper(),
            "message": message,
            "created_at": session_ts,
            "source": "website",
            "discord_message_id": None,
        }],
    }

    await db.tactical_sessions.insert_one(session)
    await db.cases.update_one(
        {"id": case["id"]},
        {
            "$set": {
                "help_session_id": session_id,
                "help_session_active": True,
                "help_discord_status": "connecting",
                "help_discord_error": None,
                "updated_at": session_ts,
            }
        },
    )

    request_data = {
        "message": message,
        "officer_id": session["officer_id"],
        "username": user["username"],
        "session_id": session_id,
    }

    discord_result = await create_support_forum_post(
        case,
        user,
        request_data,
    )

    discord_connected = False
    discord_thread_url = ""
    discord_error = ""

    if discord_result:
        thread_id = str(discord_result.get("thread_id") or "").strip()
        message_id = str(discord_result.get("message_id") or "").strip()
        parent_channel_id = str(
            discord_result.get("parent_channel_id") or ""
        ).strip()
        discord_thread_url = str(
            discord_result.get("thread_url") or ""
        ).strip()

        if thread_id:
            discord_connected = True
            await db.cases.update_one(
                {"id": case["id"]},
                {
                    "$set": {
                        "help_discord_message_id": message_id or None,
                        "help_discord_channel_id": thread_id,
                        "help_discord_parent_channel_id": parent_channel_id or None,
                        "help_discord_thread_url": discord_thread_url or None,
                        "help_discord_status": "connected",
                        "help_discord_error": None,
                        "help_session_id": session_id,
                        "help_session_active": True,
                        "updated_at": now_iso(),
                    }
                },
            )
        else:
            discord_error = str(
                discord_result.get("error")
                or "Discord responded without a forum/thread id."
            ).strip()
    else:
        discord_error = (
            "Discord Forum post could not be created."
        )

    if discord_error:
        await db.cases.update_one(
            {"id": case["id"]},
            {
                "$set": {
                    "help_discord_status": "error",
                    "help_discord_error": discord_error,
                    "updated_at": now_iso(),
                }
            },
        )

    return {
        "message": (
            "Support request sent."
            if discord_connected
            else "Support session created locally."
        ),
        "session": session,
        "discord_connected": discord_connected,
        "discord_thread_url": discord_thread_url,
        "discord_error": discord_error,
        "reused": False,
    }


@api_router.get("/cases/{case_uid}/help/session")
async def get_help_session(
    case_uid: str,
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

    if not case or not case.get("help_session_id"):
        raise HTTPException(
            status_code=404,
            detail="No live support session exists for this case.",
        )

    session = await db.tactical_sessions.find_one(
        {
            "id": case["help_session_id"],
            "active": True,
        },
        {"_id": 0},
    )

    if not session:
        raise HTTPException(
            status_code=404,
            detail="Live support session not found.",
        )

    session = await sync_discord_thread_replies(
        case,
        session,
    )

    return {
        **session,
        "discord_connected": bool(case.get("help_discord_channel_id")),
        "discord_thread_url": str(
            case.get("help_discord_thread_url") or ""
        ).strip(),
        "discord_error": str(
            case.get("help_discord_error") or ""
        ).strip(),
        "help_session_active": bool(case.get("help_session_active")),
        "help_discord_status": str(
            case.get("help_discord_status") or ""
        ).strip(),
        "help_ending_at": case.get("help_ending_at"),
        "help_ending_by": case.get("help_ending_by"),
    }


async def send_tactical_discord_message(
    case: dict,
    message: dict,
) -> Optional[str]:
    """Send a website-originated tactical message into the active Discord thread."""

    channel_id = str(case.get("help_discord_channel_id") or "").strip()
    if not channel_id:
        raise HTTPException(
            status_code=409,
            detail="The Discord support thread is not linked to this session.",
        )

    username = str(message.get("username") or "Operator").strip()
    officer_id = str(message.get("officer_id") or "").strip()
    text = str(message.get("message") or "").strip()[:2000]

    if officer_id:
        content = f"**{username} [{officer_id}]**\n{text}"
    else:
        content = f"**{username}**\n{text}"

    payload = {
        "content": content[:2000],
        "allowed_mentions": {"parse": []},
    }

    if DISCORD_BOT_TOKEN:
        url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
        headers = {
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=10) as hc:
                response = await hc.post(
                    url,
                    json=payload,
                    headers=headers,
                )

            if response.is_success:
                data = response.json()
                discord_message_id = str(
                    data.get("id") or ""
                ).strip()
                logger.info(
                    "Website support message sent to Discord thread %s as message %s.",
                    channel_id,
                    discord_message_id or "unknown",
                )
                return discord_message_id or None

            logger.warning(
                "Discord bot support message failed: HTTP %s — %s",
                response.status_code,
                response.text[:500],
            )
        except Exception as exc:
            logger.warning(
                "Discord bot support message failed: %s",
                exc,
            )

    webhook_data = await execute_discord_webhook(
        payload,
        thread_id=channel_id,
    )

    if webhook_data is not None:
        discord_message_id = str(
            webhook_data.get("id") or ""
        ).strip()
        logger.info(
            "Website support message sent to Discord thread %s via webhook as message %s.",
            channel_id,
            discord_message_id or "unknown",
        )
        return discord_message_id or None

    raise HTTPException(
        status_code=502,
        detail="Unable to deliver the support message to Discord.",
    )


@api_router.post("/cases/{case_uid}/help/chat")
async def send_help_chat_message(
    case_uid: str,
    body: TacticalMessageCreate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    text = body.message.strip()[:2000]
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    case = await db.cases.find_one(
        {"$or": [{"id": case_uid}, {"case_id": case_uid}]},
        {"_id": 0},
    )
    if not case or not case.get("help_session_id"):
        raise HTTPException(status_code=404, detail="No active live support session.")

    session_id = case["help_session_id"]
    message_id = str(uuid.uuid4())
    message = {
        "id": message_id,
        "username": user["username"],
        "officer_id": user.get("officer_id", ""),
        "message": text,
        "created_at": now_iso(),
        "source": "website",
        "discord_message_id": None,
    }

    result = await db.tactical_sessions.update_one(
        {"id": session_id, "active": True},
        {"$push": {"messages": message}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=409, detail="Live support session is no longer active.")

    async def deliver_support_message():
        try:
            current_case = case

            # The help request returns immediately while the Discord forum
            # is created in the background. Give that thread a short window
            # to become linked before sending the first website message.
            for _ in range(8):
                if current_case.get("help_discord_channel_id"):
                    break

                await asyncio.sleep(1)

                refreshed_case = await db.cases.find_one(
                    {"id": case["id"]},
                    {"_id": 0},
                )

                if refreshed_case:
                    current_case = refreshed_case

            discord_message_id = await send_tactical_discord_message(
                current_case,
                message,
            )

            if discord_message_id:
                await db.tactical_sessions.update_one(
                    {
                        "id": session_id,
                        "active": True,
                        "messages.id": message_id,
                    },
                    {
                        "$set": {
                            "messages.$.discord_message_id": discord_message_id
                        }
                    },
                )
        except Exception as exc:
            logger.warning(
                "Live support website message could not be delivered to Discord: %s",
                exc,
            )

    background_tasks.add_task(
        deliver_support_message
    )

    return message


@api_router.post("/webhook/discord-reply")
async def receive_discord_reply(
    body: DiscordReplyEvent,
    x_discord_event_secret: Optional[str] = Header(default=None),
):
    """Receive human Discord thread replies from the SCC Discord bot."""

    if not DISCORD_EVENT_SECRET:
        logger.error("DISCORD_EVENT_SECRET is not configured; rejecting Discord event.")
        raise HTTPException(
            status_code=503,
            detail="Discord event bridge is not configured on the server.",
        )

    if x_discord_event_secret != DISCORD_EVENT_SECRET:
        raise HTTPException(status_code=401, detail="Invalid Discord event secret.")

    author_data = body.author or {}
    author_is_bot = bool(
        body.bot
        or author_data.get("bot")
        or author_data.get("is_bot")
    )
    if author_is_bot:
        return {"accepted": False, "ignored": True, "reason": "bot_message"}

    text = (body.content or body.message or "").strip()[:2000]
    if not text:
        return {"accepted": False, "ignored": True, "reason": "empty_message"}

    channel_id = str(
        body.channel_id
        or body.thread_id
        or author_data.get("channel_id")
        or ""
    ).strip()
    session_id = str(body.session_id or "").strip()
    case_uid = str(body.case_uid or "").strip()
    message_id = str(body.message_id or "").strip()

    session = None
    case = None

    if session_id:
        session = await db.tactical_sessions.find_one(
            {"id": session_id, "active": True},
            {"_id": 0},
        )
        if session:
            case = await db.cases.find_one(
                {"id": session.get("case_id")},
                {"_id": 0},
            )

    if not session and case_uid:
        case = await db.cases.find_one(
            {"$or": [{"id": case_uid}, {"case_id": case_uid}]},
            {"_id": 0},
        )
        if case and case.get("help_session_id"):
            session = await db.tactical_sessions.find_one(
                {"id": case["help_session_id"], "active": True},
                {"_id": 0},
            )

    if not session and channel_id:
        case = await db.cases.find_one(
            {"help_discord_channel_id": channel_id, "help_session_id": {"$exists": True}},
            {"_id": 0},
        )
        if case and case.get("help_session_id"):
            session = await db.tactical_sessions.find_one(
                {"id": case["help_session_id"], "active": True},
                {"_id": 0},
            )

    if not session:
        logger.info(
            "Discord reply ignored because no active tactical session matched channel=%s session=%s case=%s.",
            channel_id or "unknown",
            session_id or "unknown",
            case_uid or "unknown",
        )
        return {"accepted": False, "ignored": True, "reason": "no_active_session"}

    if message_id:
        existing = await db.tactical_sessions.find_one(
            {"id": session["id"], "messages.discord_message_id": message_id},
            {"_id": 0, "messages.$": 1},
        )
        if existing:
            return {"accepted": True, "duplicate": True, "message": existing.get("messages", [{}])[0]}

    display_name = (
        body.author_display_name
        or body.author_name
        or body.author_username
        or author_data.get("display_name")
        or author_data.get("global_name")
        or author_data.get("username")
        or "COMMAND STAFF"
    ).strip()

    if not display_name.upper().endswith("[DISCORD]"):
        display_name = f"{display_name} [DISCORD]"

    incoming = {
        "id": str(uuid.uuid4()),
        "username": display_name,
        "officer_id": body.author_id or str(author_data.get("id") or ""),
        "message": text,
        "created_at": now_iso(),
        "source": "discord",
        "discord_message_id": message_id or None,
        "discord_channel_id": channel_id or None,
    }

    result = await db.tactical_sessions.update_one(
        {"id": session["id"], "active": True},
        {"$push": {"messages": incoming}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=409, detail="Live support session is no longer active.")

    logger.info(
        "Discord tactical reply received for case %s from %s.",
        case.get("case_id", "unknown") if case else "unknown",
        display_name,
    )

    return {"accepted": True, "message": incoming}


@api_router.post("/cases/{case_uid}/help/clear")
async def clear_help_session(
    case_uid: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin),
):
    case = await db.cases.find_one(
        {"$or": [{"id": case_uid}, {"case_id": case_uid}]},
        {"_id": 0},
    )

    if not case or not case.get("help_session_id"):
        raise HTTPException(
            status_code=404,
            detail="No live support session exists for this case.",
        )

    if not case.get("help_session_active"):
        raise HTTPException(
            status_code=409,
            detail="Live support session is already closed.",
        )

    existing_ending_at = str(case.get("help_ending_at") or "").strip()
    if existing_ending_at:
        return {
            "message": "Live support is already ending.",
            "case": case,
            "ending_at": existing_ending_at,
            "countdown_seconds": 5,
        }

    ending_at = await begin_support_end(case, user["username"])

    background_tasks.add_task(
        finalize_support_end,
        case["id"],
        case["help_session_id"],
        user["username"],
        ending_at,
    )

    updated = await db.cases.find_one({"id": case["id"]}, {"_id": 0})

    return {
        "message": "Live support ending in 5 seconds.",
        "case": updated,
        "ending_at": ending_at,
        "countdown_seconds": 5,
    }




@api_router.get("/discord/interactions/status")
async def discord_interactions_status():
    return {
        "enabled": bool(DISCORD_PUBLIC_KEY),
        "public_key_ready": bool(DISCORD_PUBLIC_KEY),
        "bot_token_configured": bool(DISCORD_BOT_TOKEN),
        "support_channel_configured": bool(DISCORD_SUPPORT_CHANNEL_ID),
        "endpoint": "/api/discord/interactions",
        "root_alias": "/discord/interactions",
        "commands": ["/reply", "/end"],
        "gateway_connected": (
            discord_gateway_client.is_ready()
            if "discord_gateway_client" in globals()
            else False
        ),
    }


@api_router.post("/discord/interactions")
async def discord_interactions(
    request: Request,
    background_tasks: BackgroundTasks,
):
    raw_body = await request.body()
    signature = request.headers.get("X-Signature-Ed25519", "")
    timestamp = request.headers.get("X-Signature-Timestamp", "")

    if not verify_discord_interaction_signature(
        raw_body,
        signature,
        timestamp,
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid Discord interaction signature.",
        )

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid Discord interaction payload.",
        )

    interaction_type = payload.get("type")

    if interaction_type == 1:
        return {"type": 1}

    data = payload.get("data") or {}
    custom_id = str(data.get("custom_id") or "")

    member = payload.get("member") or {}
    discord_user = member.get("user") or payload.get("user") or {}

    author_name = (
        member.get("nick")
        or discord_user.get("global_name")
        or discord_user.get("username")
        or "COMMAND STAFF"
    )
    author_id = str(discord_user.get("id") or "").strip()

    # Guild slash commands: /reply and /end.
    # Discord requires the initial response within roughly three seconds,
    # so do not wait for MongoDB before acknowledging the command.
    if interaction_type == 2:
        command_name = str(
            data.get("name") or ""
        ).lower().strip()

        channel_id = str(
            payload.get("channel_id") or ""
        ).strip()

        if command_name == "reply":
            return {
                "type": 9,
                "data": {
                    "custom_id": (
                        f"scc_support_slash_reply_channel:{channel_id}"
                    ),
                    "title": "SCC Live Support Reply",
                    "components": [
                        {
                            "type": 1,
                            "components": [
                                {
                                    "type": 4,
                                    "custom_id": "reply_text",
                                    "label": "Reply",
                                    "style": 2,
                                    "min_length": 1,
                                    "max_length": 1800,
                                    "required": True,
                                    "placeholder": "Type your reply...",
                                }
                            ],
                        }
                    ],
                },
            }

        if command_name == "end":
            background_tasks.add_task(
                end_support_from_discord_channel,
                channel_id,
                author_name,
            )

            return {
                "type": 4,
                "data": {
                    "content": (
                        "Live Support is ending. "
                        "The session will close in 5 seconds."
                    ),
                    "flags": 64,
                },
            }

        return {
            "type": 4,
            "data": {
                "content": "Unsupported SCC command.",
                "flags": 64,
            },
        }

    if (
        interaction_type == 3
        and custom_id.startswith("scc_support_reply:")
    ):
        session_id = custom_id.split(":", 1)[1].strip()
        return {
            "type": 9,
            "data": {
                "custom_id": f"scc_support_reply_modal:{session_id}",
                "title": "SCC Live Support Reply",
                "components": [{
                    "type": 1,
                    "components": [{
                        "type": 4,
                        "custom_id": "reply_text",
                        "label": "Command response",
                        "style": 2,
                        "min_length": 1,
                        "max_length": 1800,
                        "required": True,
                        "placeholder": "Type the reply for the case support thread...",
                    }],
                }],
            },
        }

    if (
        interaction_type == 3
        and custom_id.startswith("scc_support_end:")
    ):
        session_id = custom_id.split(":", 1)[1].strip()

        # Acknowledge Discord immediately, then do Mongo/Discord work after
        # the response so the button does not time out on Render.
        background_tasks.add_task(
            end_support_from_discord_interaction,
            session_id,
            author_name,
        )

        return {
            "type": 4,
            "data": {
                "content": (
                    "Live Support is ending. "
                    "The session will close in 5 seconds."
                ),
                "flags": 64,
            },
        }

    if (
        interaction_type == 5
        and (
            custom_id.startswith("scc_support_reply_modal:")
            or custom_id.startswith("scc_support_slash_reply_modal:")
            or custom_id.startswith("scc_support_slash_reply_channel:")
        )
    ):
        reply_target = custom_id.split(":", 1)[1].strip()
        reply_text = ""

        for row in data.get("components") or []:
            for component in row.get("components") or []:
                if component.get("custom_id") == "reply_text":
                    reply_text = str(
                        component.get("value") or ""
                    ).strip()

        if not reply_text:
            return {
                "type": 4,
                "data": {
                    "content": "Reply cannot be empty.",
                    "flags": 64,
                },
            }

        # Acknowledge the modal immediately, then post to the case thread
        # and save to Mongo in the background.
        if custom_id.startswith(
            "scc_support_slash_reply_channel:"
        ):
            background_tasks.add_task(
                reply_from_discord_channel,
                reply_target,
                author_name,
                author_id,
                reply_text,
            )
        else:
            background_tasks.add_task(
                reply_from_discord_interaction,
                reply_target,
                author_name,
                author_id,
                reply_text,
            )

        return {
            "type": 4,
            "data": {
                "content": "Reply sent to the case support thread.",
                "flags": 64,
            },
        }

    return {
        "type": 4,
        "data": {
            "content": "Unsupported SCC interaction.",
            "flags": 64,
        },
    }



@api_router.post("/cases/{case_uid}/help/end")
async def end_help_session(
    case_uid: str,
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

    if not case or not case.get("help_session_id"):
        raise HTTPException(
            status_code=404,
            detail="No live support session exists for this case.",
        )

    if not case.get("help_session_active"):
        raise HTTPException(
            status_code=409,
            detail="Live support session is already closed.",
        )

    existing_ending_at = str(
        case.get("help_ending_at") or ""
    ).strip()

    if existing_ending_at:
        return {
            "message": "Live support is already ending.",
            "case": case,
            "ending_at": existing_ending_at,
            "countdown_seconds": 5,
        }

    ended_by = str(
        user.get("username") or "OPERATOR"
    ).strip()

    ending_at = await begin_support_end(
        case,
        ended_by,
    )

    background_tasks.add_task(
        finalize_support_end,
        case["id"],
        case["help_session_id"],
        ended_by,
        ending_at,
    )

    updated = await db.cases.find_one(
        {"id": case["id"]},
        {"_id": 0},
    )

    return {
        "message": "Live support ending in 5 seconds.",
        "case": updated,
        "ending_at": ending_at,
        "countdown_seconds": 5,
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


# ---------------------------------------------------------------------------\n# Investigation workspace / Command Centre\n# ---------------------------------------------------------------------------\n\ndef _activity(actor: str, action: str, detail: str = "") -> dict:\n    return {"id": str(uuid.uuid4()), "actor": actor, "action": action, "detail": detail, "created_at": now_iso()}\n\nasync def _workspace_case(case_uid: str) -> dict:\n    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0})\n    if not doc:\n        raise HTTPException(status_code=404, detail="Case file not found.")\n    if doc.get("status") not in {"opened", "closed"} and not doc.get("workspace_unlocked"):\n        raise HTTPException(status_code=400, detail="Investigation workspace is not unlocked.")\n    return doc\n\n@api_router.post("/cases/{case_uid}/investigation-log", response_model=Case)\nasync def add_investigation_log(case_uid: str, body: InvestigationLogCreate, user: dict = Depends(get_current_user)):\n    await _workspace_case(case_uid)\n    if not body.action_taken.strip():\n        raise HTTPException(status_code=400, detail="Action taken is required.")\n    ts = now_iso()\n    entry = {"id": str(uuid.uuid4()), "entry": ts, "date_time": ts, "officer": user["username"], "officer_id": user.get("officer_id", ""), "action_taken": body.action_taken.strip(), "information_obtained": body.information_obtained.strip(), "outcome_further_action": body.outcome_further_action.strip(), "related_records": body.related_records.strip()}\n    await db.cases.update_one({"id": case_uid}, {"$push": {"investigation_log": entry, "activity_log": _activity(user["username"], "INVESTIGATION LOG ENTRY ADDED", body.action_taken.strip()[:180])}, "$set": {"updated_at": ts}})\n    return await db.cases.find_one({"id": case_uid}, {"_id": 0})\n\n@api_router.post("/cases/{case_uid}/evidence", response_model=Case)\nasync def upload_evidence(case_uid: str, request: Request, user: dict = Depends(get_current_user)):\n    await _workspace_case(case_uid)\n    raw = await request.body()\n    if not raw:\n        raise HTTPException(status_code=400, detail="Evidence file is empty.")\n    if len(raw) > 50 * 1024 * 1024:\n        raise HTTPException(status_code=413, detail="Evidence files are limited to 50 MB.")\n    filename = request.headers.get("x-scc-filename", "evidence-file").strip()[:180]\n    evidence_type = request.headers.get("x-scc-evidence-type", "Other").strip()[:80]\n    description = request.headers.get("x-scc-description", "").strip()[:1500]\n    content_type = request.headers.get("content-type", "application/octet-stream").split(";")[0]\n    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0, "case_id": 1, "evidence": 1})\n    existing = doc.get("evidence") or []\n    suffix = str(doc.get("case_id") or "SCC").split("-")[-1]\n    number = max([int(str(x.get("evidence_id", "0")).split("-")[-1]) for x in existing if str(x.get("evidence_id", "")).split("-")[-1].isdigit()] or [0]) + 1\n    evidence_id = f"EVD-{suffix}-{number:03d}"\n    file_id = await evidence_fs.upload_from_stream(filename, raw, metadata={"case_uid": case_uid, "evidence_id": evidence_id, "content_type": content_type})\n    ts = now_iso()\n    item = {"id": str(uuid.uuid4()), "evidence_id": evidence_id, "type": evidence_type, "description": description, "filename": filename, "content_type": content_type, "size": len(raw), "file_id": str(file_id), "uploaded_by": user["username"], "uploaded_at": ts, "removed": False}\n    await db.cases.update_one({"id": case_uid}, {"$push": {"evidence": item, "activity_log": _activity(user["username"], "EVIDENCE ADDED", f"{evidence_id} · {filename}")}, "$set": {"updated_at": ts}})\n    return await db.cases.find_one({"id": case_uid}, {"_id": 0})\n\n@api_router.get("/cases/{case_uid}/evidence/{evidence_id}/file")\nasync def get_evidence_file(case_uid: str, evidence_id: str, user: dict = Depends(get_current_user)):\n    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0, "evidence": 1})\n    if not doc:\n        raise HTTPException(status_code=404, detail="Case file not found.")\n    item = next((x for x in (doc.get("evidence") or []) if x.get("evidence_id") == evidence_id and not x.get("removed")), None)\n    if not item or not item.get("file_id"):\n        raise HTTPException(status_code=404, detail="Evidence file not found.")\n    import io\n    stream = io.BytesIO()\n    try:\n        await evidence_fs.download_to_stream(ObjectId(item["file_id"]), stream)\n    except Exception:\n        raise HTTPException(status_code=404, detail="Evidence file not found.")\n    headers = {"Content-Disposition": f'inline; filename="{item.get("filename", "evidence")}"', "Cache-Control": "private, no-store"}\n    return Response(stream.getvalue(), media_type=item.get("content_type") or "application/octet-stream", headers=headers)\n\n@api_router.post("/cases/{case_uid}/evidence/{evidence_id}/remove", response_model=Case)\nasync def remove_evidence(case_uid: str, evidence_id: str, body: EvidenceRemoveRequest, user: dict = Depends(require_admin)):\n    reason = body.reason.strip()\n    if not reason:\n        raise HTTPException(status_code=400, detail="A removal reason is required.")\n    ts = now_iso()\n    result = await db.cases.update_one({"id": case_uid, "evidence.evidence_id": evidence_id}, {"$set": {"evidence.$.removed": True, "evidence.$.removed_by": user["username"], "evidence.$.removed_at": ts, "evidence.$.removal_reason": reason, "updated_at": ts}, "$push": {"activity_log": _activity(user["username"], "EVIDENCE REMOVED", f"{evidence_id} · {reason}")}})\n    if not result.matched_count:\n        raise HTTPException(status_code=404, detail="Evidence item not found.")\n    return await db.cases.find_one({"id": case_uid}, {"_id": 0})\n\n@api_router.post("/cases/{case_uid}/personnel", response_model=Case)\nasync def assign_personnel(case_uid: str, body: PersonnelRequest, user: dict = Depends(require_admin)):\n    investigator = body.investigator.strip()\n    if not investigator:\n        raise HTTPException(status_code=400, detail="Investigator is required.")\n    ts = now_iso()\n    await db.cases.update_one({"id": case_uid}, {"$addToSet": {"assigned_investigators": investigator}, "$push": {"activity_log": _activity(user["username"], "INVESTIGATOR ASSIGNED", investigator)}, "$set": {"updated_at": ts}})\n    return await db.cases.find_one({"id": case_uid}, {"_id": 0})\n\n@api_router.delete("/cases/{case_uid}/personnel/{investigator}", response_model=Case)\nasync def unassign_personnel(case_uid: str, investigator: str, user: dict = Depends(require_admin)):\n    ts = now_iso()\n    await db.cases.update_one({"id": case_uid}, {"$pull": {"assigned_investigators": investigator}, "$push": {"activity_log": _activity(user["username"], "INVESTIGATOR UNASSIGNED", investigator)}, "$set": {"updated_at": ts}})\n    return await db.cases.find_one({"id": case_uid}, {"_id": 0})\n\n@api_router.post("/cases/{case_uid}/command-requests", response_model=Case)\nasync def create_command_request(case_uid: str, body: CommandRequestCreate, user: dict = Depends(get_current_user)):\n    await _workspace_case(case_uid)\n    ts = now_iso()\n    req = {"id": str(uuid.uuid4()), "request_type": body.request_type.strip(), "details": body.details.strip(), "requested_value": body.requested_value.strip(), "status": "pending", "requested_by": user["username"], "requested_at": ts}\n    await db.cases.update_one({"id": case_uid}, {"$push": {"command_requests": req, "activity_log": _activity(user["username"], "COMMAND REQUEST SUBMITTED", req["request_type"])}, "$set": {"updated_at": ts}})\n    return await db.cases.find_one({"id": case_uid}, {"_id": 0})\n\n@api_router.post("/cases/{case_uid}/command-requests/{request_id}/decision", response_model=Case)\nasync def decide_command_request(case_uid: str, request_id: str, body: CommandRequestDecision, user: dict = Depends(require_admin)):\n    decision = body.decision.strip().lower()\n    if decision not in {"approved", "denied", "returned"}:\n        raise HTTPException(status_code=400, detail="Invalid command decision.")\n    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0})\n    req = next((x for x in (doc or {}).get("command_requests", []) if x.get("id") == request_id), None)\n    if not req:\n        raise HTTPException(status_code=404, detail="Command request not found.")\n    ts = now_iso()\n    await db.cases.update_one({"id": case_uid, "command_requests.id": request_id}, {"$set": {"command_requests.$.status": decision, "command_requests.$.decision_reason": body.reason.strip(), "command_requests.$.decided_by": user["username"], "command_requests.$.decided_at": ts, "updated_at": ts}, "$push": {"activity_log": _activity(user["username"], f"COMMAND REQUEST {decision.upper()}", req.get("request_type", ""))}})\n    # Apply approved priority requests automatically.\n    if decision == "approved" and req.get("request_type") == "priority_change" and req.get("requested_value") in PRIORITIES:\n        await db.cases.update_one({"id": case_uid}, {"$set": {"priority": req["requested_value"], "updated_at": ts}})\n    return await db.cases.find_one({"id": case_uid}, {"_id": 0})\n\n@api_router.put("/cases/{case_uid}/command-flags", response_model=Case)\nasync def update_command_flags(case_uid: str, body: CommandFlagsUpdate, user: dict = Depends(require_admin)):\n    allowed = {"Command Attention", "Restricted", "Urgent Review"}\n    flags = [x for x in body.flags if x in allowed]\n    ts = now_iso()\n    await db.cases.update_one({"id": case_uid}, {"$set": {"command_flags": flags, "updated_at": ts}, "$push": {"activity_log": _activity(user["username"], "COMMAND FLAGS UPDATED", ", ".join(flags) or "Cleared")}})\n    return await db.cases.find_one({"id": case_uid}, {"_id": 0})\n\n@api_router.post("/cases/{case_uid}/command-notes", response_model=Case)\nasync def add_command_note(case_uid: str, body: CommandNoteCreate, user: dict = Depends(require_admin)):\n    note = body.note.strip()\n    if not note:\n        raise HTTPException(status_code=400, detail="Command note cannot be empty.")\n    ts = now_iso()\n    item = {"id": str(uuid.uuid4()), "note": note, "author": user["username"], "created_at": ts}\n    await db.cases.update_one({"id": case_uid}, {"$push": {"command_notes": item, "activity_log": _activity(user["username"], "COMMAND NOTE ADDED")}, "$set": {"updated_at": ts}})\n    return await db.cases.find_one({"id": case_uid}, {"_id": 0})\n\n@api_router.post("/cases/{case_uid}/closure-request", response_model=Case)\nasync def request_closure(case_uid: str, body: ClosureRequestCreate, user: dict = Depends(get_current_user)):\n    summary = body.outcome_summary.strip()\n    if not summary:\n        raise HTTPException(status_code=400, detail="Closure outcome summary is required.")\n    ts = now_iso()\n    item = {"status": "pending", "outcome_summary": summary, "requested_by": user["username"], "requested_at": ts}\n    await db.cases.update_one({"id": case_uid}, {"$set": {"closure_request": item, "updated_at": ts}, "$push": {"activity_log": _activity(user["username"], "CASE CLOSURE REQUESTED", summary[:180])}})\n    return await db.cases.find_one({"id": case_uid}, {"_id": 0})\n\n@api_router.post("/cases/{case_uid}/closure-request/{decision}", response_model=Case)\nasync def decide_closure(case_uid: str, decision: str, user: dict = Depends(require_admin)):\n    if decision not in {"approve", "return"}:\n        raise HTTPException(status_code=400, detail="Invalid closure decision.")\n    doc = await db.cases.find_one({"id": case_uid}, {"_id": 0})\n    if not doc or not doc.get("closure_request"):\n        raise HTTPException(status_code=404, detail="Closure request not found.")\n    ts = now_iso()\n    status = "closed" if decision == "approve" else doc.get("status", "opened")\n    closure = dict(doc["closure_request"]); closure.update({"status": "approved" if decision == "approve" else "returned", "decided_by": user["username"], "decided_at": ts})\n    await db.cases.update_one({"id": case_uid}, {"$set": {"closure_request": closure, "status": status, "updated_at": ts}, "$push": {"activity_log": _activity(user["username"], "CASE CLOSED" if decision == "approve" else "CLOSURE RETURNED TO INVESTIGATOR")}})\n    return await db.cases.find_one({"id": case_uid}, {"_id": 0})\n\n# ---------------------------------------------------------------------------
# Approve case
# ---------------------------------------------------------------------------

@api_router.post(
    "/cases/{case_uid}/approve",
    response_model=Case,
)
async def approve_case(
    case_uid: str,
    background_tasks: BackgroundTasks,
    body: ApprovalReviewRequest = ApprovalReviewRequest(),
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

    review_changes = {}
    if body.change_requested:
        if body.division is not None and body.division not in DIVISIONS:
            raise HTTPException(
                status_code=400,
                detail="Invalid division selected.",
            )
        if body.priority is not None and body.priority not in PRIORITIES:
            raise HTTPException(
                status_code=400,
                detail="Invalid priority selected.",
            )

        editable_fields = (
            "name",
            "lead_investigator",
            "division",
            "priority",
            "request_basis",
            "known_information",
            "investigation_objective",
        )
        submitted = body.model_dump()

        for field_name in editable_fields:
            value = submitted.get(field_name)
            if value is None:
                continue
            if isinstance(value, str):
                value = value.strip()
            if field_name in {"name", "lead_investigator"} and not value:
                raise HTTPException(
                    status_code=400,
                    detail=f"{field_name.replace('_', ' ').title()} cannot be blank.",
                )
            review_changes[field_name] = value

        if "request_basis" in review_changes:
            review_changes["synopsis"] = review_changes["request_basis"]

        if review_changes:
            review_changes["command_adjusted_by"] = user["username"]
            review_changes["command_adjusted_at"] = now_iso()
            doc = {**doc, **review_changes}

    ts = now_iso()

    approval_detail = (
        " Command adjusted the submitted request before authorisation."
        if review_changes
        else ""
    )

    entry = TimelineNote(
        note=(
            f"Case approved and opened by "
            f"{user['username']}. Formal case file created."
            f"{approval_detail}"
        ),
        author=user["username"],
        kind="system",
        created_at=ts,
    )

    case_file = {
        "created_at": ts,
        "created_by": user["username"],
        "professional_summary": build_professional_case_summary(doc),
        "investigation_basis": str(
            doc.get("request_basis") or doc.get("synopsis") or ""
        ).strip(),
        "known_information": str(
            doc.get("known_information") or ""
        ).strip(),
        "investigation_objective": str(
            doc.get("investigation_objective") or ""
        ).strip(),
        "evidence": build_initial_evidence_register(
            doc,
            user["username"],
            ts,
        ),
        "investigation_log": [],
        "assigned_investigators": (
            [str(doc.get("lead_investigator") or "").strip()]
            if str(doc.get("lead_investigator") or "").strip()
            else []
        ),
    }

    await db.cases.update_one(
        {"id": case_uid},
        {
            "$set": {
                **review_changes,
                "status": "opened",
                "approved_by": user["username"],
                "approved_at": ts,
                "updated_at": ts,
                "workspace_unlocked": True,
                "case_file": case_file,
                "investigation_log": doc.get("investigation_log") or [],
                "evidence": doc.get("evidence") or case_file["evidence"],
                "assigned_investigators": doc.get("assigned_investigators") or [doc.get("lead_investigator")],
                "activity_log": (doc.get("activity_log") or []) + [_activity(user["username"], "INVESTIGATION AUTHORISED", f"Priority: {doc.get('priority', 'routine')}")],
                "command_requests": doc.get("command_requests") or [],
                "command_flags": doc.get("command_flags") or [],
                "command_notes": doc.get("command_notes") or [],
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
    body: DenyRequest,
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
    denial_reason = body.denial_reason.strip()[:2000]

    if not denial_reason:
        raise HTTPException(
            status_code=400,
            detail="A denial reason is required.",
        )

    entry = TimelineNote(
        note=(
            f"Case denied by {user['username']}."
            + (f" Reason: {denial_reason}" if denial_reason else "")
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
                "denial_reason": denial_reason or None,
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
        denial_reason,
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



async def ensure_discord_public_key():
    """
    Resolve the interaction verification key from the Discord application
    attached to DISCORD_BOT_TOKEN.

    This removes the easy-to-miss requirement to manually copy the public
    key into Render, while still accepting DISCORD_PUBLIC_KEY when supplied.
    """
    global DISCORD_PUBLIC_KEY

    if DISCORD_PUBLIC_KEY:
        return DISCORD_PUBLIC_KEY

    if not DISCORD_BOT_TOKEN:
        logger.warning(
            "Discord public key could not be resolved because "
            "DISCORD_BOT_TOKEN is missing."
        )
        return ""

    headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as hc:
            response = await hc.get(
                "https://discord.com/api/v10/oauth2/applications/@me",
                headers=headers,
            )

        if not response.is_success:
            logger.warning(
                "Discord public-key lookup failed: HTTP %s — %s",
                response.status_code,
                response.text[:300],
            )
            return ""

        application = response.json()

        resolved_key = str(
            application.get("verify_key") or ""
        ).strip()

        if resolved_key:
            DISCORD_PUBLIC_KEY = resolved_key
            logger.info(
                "Discord interaction public key resolved automatically."
            )
            return DISCORD_PUBLIC_KEY

        logger.warning(
            "Discord application response contained no verify_key."
        )
    except Exception as exc:
        logger.warning(
            "Discord public-key lookup failed: %s",
            exc,
        )

    return ""


async def end_support_from_discord_channel(
    channel_id: str,
    ended_by: str,
):
    case = await get_active_support_case_by_discord_channel(
        channel_id
    )

    if not case:
        logger.info(
            "Discord /end ignored because channel %s is not linked "
            "to an active SCC support session.",
            channel_id,
        )
        return

    await end_support_from_discord_interaction(
        str(case.get("help_session_id") or ""),
        ended_by,
    )


async def reply_from_discord_channel(
    channel_id: str,
    author_name: str,
    author_id: str,
    reply_text: str,
):
    case = await get_active_support_case_by_discord_channel(
        channel_id
    )

    if not case:
        logger.info(
            "Discord /reply ignored because channel %s is not linked "
            "to an active SCC support session.",
            channel_id,
        )
        return

    session_id = str(
        case.get("help_session_id") or ""
    ).strip()

    if not session_id:
        return

    await reply_from_discord_interaction(
        session_id,
        author_name,
        author_id,
        reply_text,
    )


async def register_discord_slash_commands():
    """
    Register the two simple guild slash commands used by SCC Live Support.

    /reply -> opens a reply modal inside an active SCC support thread.
    /end   -> starts the same 5-second ending flow as End Support.
    """
    if not DISCORD_BOT_TOKEN or not DISCORD_GUILD_ID:
        logger.warning(
            "Discord slash commands were not registered because the bot token "
            "or guild ID is missing."
        )
        return

    headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=12) as hc:
            app_response = await hc.get(
                "https://discord.com/api/v10/oauth2/applications/@me",
                headers=headers,
            )

        if not app_response.is_success:
            logger.warning(
                "Discord application lookup failed: HTTP %s — %s",
                app_response.status_code,
                app_response.text[:300],
            )
            return

        application_id = str(
            app_response.json().get("id") or ""
        ).strip()

        if not application_id:
            logger.warning(
                "Discord application lookup returned no application ID."
            )
            return

        commands = [
            {
                "name": "reply",
                "description": "Reply to this SCC support chat",
                "type": 1,
            },
            {
                "name": "end",
                "description": "End this SCC support chat",
                "type": 1,
            },
        ]

        async with httpx.AsyncClient(timeout=12) as hc:
            response = await hc.put(
                (
                    "https://discord.com/api/v10/applications/"
                    f"{application_id}/guilds/{DISCORD_GUILD_ID}/commands"
                ),
                json=commands,
                headers=headers,
            )

        if response.is_success:
            logger.info(
                "Discord SCC slash commands registered: /reply, /end"
            )
        else:
            logger.warning(
                "Discord slash command registration failed: HTTP %s — %s",
                response.status_code,
                response.text[:400],
            )
    except Exception as exc:
        logger.warning(
            "Discord slash command registration failed: %s",
            exc,
        )


async def get_active_support_case_by_discord_channel(
    channel_id: str,
):
    channel_id = str(channel_id or "").strip()

    if not channel_id:
        return None

    return await db.cases.find_one(
        {
            "help_discord_channel_id": channel_id,
            "help_session_active": True,
        },
        {"_id": 0},
    )



# ---------------------------------------------------------------------------
# Discord Gateway bot
# ---------------------------------------------------------------------------

discord_intents = discord.Intents.default()
discord_gateway_client = discord.Client(
    intents=discord_intents,
)
discord_gateway_tree = app_commands.CommandTree(
    discord_gateway_client
)

discord_gateway_task = None
discord_gateway_synced = False

SCC_DISCORD_GUILD = (
    discord.Object(id=int(DISCORD_GUILD_ID))
    if str(DISCORD_GUILD_ID or "").isdigit()
    else None
)


class SCCGatewayReplyModal(
    discord.ui.Modal,
    title="SCC Live Support Reply",
):
    reply_text = discord.ui.TextInput(
        label="Reply",
        placeholder="Type your reply...",
        style=discord.TextStyle.paragraph,
        min_length=1,
        max_length=1800,
        required=True,
    )

    def __init__(self, *, channel_id: str = "", session_id: str = ""):
        super().__init__(timeout=300)
        self.channel_id = str(channel_id or "").strip()
        self.session_id = str(session_id or "").strip()

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(
            ephemeral=True,
            thinking=True,
        )

        author_name = (
            getattr(interaction.user, "display_name", None)
            or getattr(interaction.user, "name", None)
            or "Support Agent"
        )
        author_id = str(
            getattr(interaction.user, "id", "")
        )
        reply_value = str(
            self.reply_text.value or ""
        ).strip()

        if self.session_id:
            await reply_from_discord_interaction(
                self.session_id,
                author_name,
                author_id,
                reply_value,
            )
        else:
            await reply_from_discord_channel(
                self.channel_id,
                author_name,
                author_id,
                reply_value,
            )

        await interaction.followup.send(
            "Reply sent.",
            ephemeral=True,
        )


async def gateway_reply_command(
    interaction: discord.Interaction,
):
    await interaction.response.send_modal(
        SCCGatewayReplyModal(
            channel_id=str(
                interaction.channel_id or ""
            )
        )
    )


async def gateway_end_command(
    interaction: discord.Interaction,
):
    await interaction.response.defer(
        ephemeral=True,
        thinking=True,
    )

    channel_id = str(
        interaction.channel_id or ""
    ).strip()

    case = await get_active_support_case_by_discord_channel(
        channel_id
    )

    if not case:
        await interaction.followup.send(
            "This command only works inside an active SCC support thread.",
            ephemeral=True,
        )
        return

    author_name = (
        getattr(interaction.user, "display_name", None)
        or getattr(interaction.user, "name", None)
        or "Support Agent"
    )

    await end_support_from_discord_interaction(
        str(case.get("help_session_id") or ""),
        author_name,
    )

    await interaction.followup.send(
        "Live Support is ending.",
        ephemeral=True,
    )


if SCC_DISCORD_GUILD is not None:
    discord_gateway_tree.add_command(
        app_commands.Command(
            name="reply",
            description="Reply to this SCC support chat",
            callback=gateway_reply_command,
        ),
        guild=SCC_DISCORD_GUILD,
        override=True,
    )

    discord_gateway_tree.add_command(
        app_commands.Command(
            name="end",
            description="End this SCC support chat",
            callback=gateway_end_command,
        ),
        guild=SCC_DISCORD_GUILD,
        override=True,
    )


@discord_gateway_client.event
async def on_interaction(
    interaction: discord.Interaction,
):
    if interaction.type != discord.InteractionType.component:
        return

    custom_id = str(
        (interaction.data or {}).get("custom_id") or ""
    )

    if custom_id.startswith("scc_support_reply:"):
        session_id = custom_id.split(":", 1)[1].strip()

        await interaction.response.send_modal(
            SCCGatewayReplyModal(
                session_id=session_id,
            )
        )
        return

    if custom_id.startswith("scc_support_end:"):
        session_id = custom_id.split(":", 1)[1].strip()

        await interaction.response.defer(
            ephemeral=True,
            thinking=True,
        )

        author_name = (
            getattr(interaction.user, "display_name", None)
            or getattr(interaction.user, "name", None)
            or "Support Agent"
        )

        await end_support_from_discord_interaction(
            session_id,
            author_name,
        )

        await interaction.followup.send(
            "Live Support is ending.",
            ephemeral=True,
        )


@discord_gateway_client.event
async def on_ready():
    global discord_gateway_synced

    logger.info(
        "Discord Gateway connected as %s (%s).",
        discord_gateway_client.user,
        getattr(discord_gateway_client.user, "id", "unknown"),
    )

    if (
        not discord_gateway_synced
        and SCC_DISCORD_GUILD is not None
    ):
        try:
            synced = await discord_gateway_tree.sync(
                guild=SCC_DISCORD_GUILD
            )
            discord_gateway_synced = True

            logger.info(
                "Discord Gateway slash commands synced: %s",
                ", ".join(
                    f"/{command.name}"
                    for command in synced
                ) or "none",
            )
        except Exception as exc:
            logger.exception(
                "Discord Gateway slash-command sync failed: %s",
                exc,
            )


def _discord_gateway_task_done(task: asyncio.Task):
    try:
        error = task.exception()
    except asyncio.CancelledError:
        return

    if error:
        logger.error(
            "Discord Gateway task stopped unexpectedly: %s",
            error,
        )


async def start_discord_gateway():
    global discord_gateway_task

    if not DISCORD_BOT_TOKEN:
        logger.warning(
            "Discord Gateway not started: DISCORD_BOT_TOKEN is missing."
        )
        return

    if (
        discord_gateway_task
        and not discord_gateway_task.done()
    ):
        return

    discord_gateway_task = asyncio.create_task(
        discord_gateway_client.start(
            DISCORD_BOT_TOKEN
        ),
        name="scc-discord-gateway",
    )
    discord_gateway_task.add_done_callback(
        _discord_gateway_task_done
    )


async def stop_discord_gateway():
    global discord_gateway_task

    if not discord_gateway_client.is_closed():
        await discord_gateway_client.close()

    if discord_gateway_task:
        try:
            await asyncio.wait_for(
                discord_gateway_task,
                timeout=5,
            )
        except (
            asyncio.TimeoutError,
            asyncio.CancelledError,
        ):
            discord_gateway_task.cancel()

        discord_gateway_task = None


@app.on_event("startup")
async def startup():
    await start_discord_gateway()


app.include_router(
    api_router
)


@app.post("/discord/interactions")
async def discord_interactions_root_alias(
    request: Request,
    background_tasks: BackgroundTasks,
):
    return await discord_interactions(
        request,
        background_tasks,
    )


@app.get("/discord/interactions/status")
async def discord_interactions_status_root_alias():
    return await discord_interactions_status()




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
async def shutdown_services():
    await stop_discord_gateway()
    client.close()