from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import asyncio
import re
from urllib.parse import quote
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
    Header,
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

DISCORD_BOT_TOKEN = os.environ.get(
    "DISCORD_BOT_TOKEN",
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
                response = await hc.post(url, json=payload)

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
            f"💬 LIVE SUPPORT CHAT — "
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
        "💬 **SCC LIVE SUPPORT REQUEST — COMMAND RESPONSE REQUIRED.**"
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

    # Normal guild text channel. Create one public thread per case so Discord
    # replies stay isolated and can sync back to the correct website chat.
    if channel_type == 0:
        thread_payload = {
            "name": thread_name,
            "auto_archive_duration": 1440,
            "type": 11,
            "invitable": False,
        }

        try:
            async with httpx.AsyncClient(timeout=15) as hc:
                thread_response = await hc.post(
                    f"https://discord.com/api/v10/channels/{parent_id}/threads",
                    json=thread_payload,
                    headers=headers,
                )
        except Exception as exc:
            return {"error": f"Discord support thread creation failed: {exc}"}

        if not thread_response.is_success:
            return {
                "error": (
                    f"Discord support thread creation failed "
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
            return {"error": "Discord created no support thread ID."}

        starter_payload = {
            "content": content,
            "embeds": [embed],
            "allowed_mentions": allowed_mentions,
        }

        try:
            async with httpx.AsyncClient(timeout=15) as hc:
                message_response = await hc.post(
                    f"https://discord.com/api/v10/channels/{thread_id}/messages",
                    json=starter_payload,
                    headers=headers,
                )
        except Exception as exc:
            return {
                "error": (
                    "Discord support thread was created, but the starter "
                    f"message failed: {exc}"
                )
            }

        if not message_response.is_success:
            return {
                "error": (
                    "Discord support thread was created, but the starter "
                    f"message failed (HTTP {message_response.status_code}): "
                    f"{message_response.text[:350]}"
                )
            }

        message_data = message_response.json()
        thread_url = await build_discord_thread_url(thread_id, guild_id)

        return {
            "thread_id": thread_id,
            "message_id": str(message_data.get("id") or ""),
            "guild_id": guild_id,
            "thread_url": thread_url,
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

        display_name = (
            author.get("global_name")
            or author.get("username")
            or "COMMAND STAFF"
        )

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

    mentions = " ".join(f"<@&{rid}>" for rid in DISCORD_PING_ROLE_IDS)
    priority = case.get("priority", "routine")
    priority_label = {
        "routine": "Routine",
        "urgent": "Urgent",
        "high-risk": "High-Risk",
    }.get(priority, str(priority).title())

    synopsis = (case.get("synopsis") or "").strip() or "No synopsis recorded."

    # Embed 1 — top operational banner image only.
    banner_embed = {
        "image": {
            "url": CASE_BANNER_URL,
        },
    }

    # Embed 2 — dossier content only.
    dossier_embed = {
        "title": "STATE CRIME COMMAND // CASE DOSSIER",
        "fields": [
            {
                "name": "CASE ID",
                "value": f"`{case.get('case_id', '—')}`",
                "inline": True,
            },
            {
                "name": "OPERATION NAME",
                "value": case.get("name", "Untitled Case"),
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
                "name": "PRIORITY",
                "value": priority_label,
                "inline": True,
            },
            {
                "name": "SYNOPSIS",
                "value": synopsis[:1024],
                "inline": False,
            },
        ],
    }

    # Embed 3 — system footer artwork and automated timestamp only.
    system_base_embed = {
        "image": {
            "url": DISCORD_FOOTER_ICON_URL,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    payload = {
        "content": mentions,
        "embeds": [
            banner_embed,
            dossier_embed,
            system_base_embed,
        ],
        "allowed_mentions": {
            "parse": ["roles"],
        },
    }

    thread_name = (
        f"{case.get('case_id', 'SCC')} • "
        f"{case.get('name', 'Case File')}"
    )[:100]

    data = await execute_discord_webhook(
        payload,
        thread_name=thread_name,
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


class DenyRequest(BaseModel):
    denial_reason: str


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
    help_discord_message_id: Optional[str] = None
    help_discord_channel_id: Optional[str] = None
    help_discord_thread_url: Optional[str] = None
    help_discord_status: Optional[str] = None
    help_discord_error: Optional[str] = None
    help_session_id: Optional[str] = None
    help_session_active: bool = False
    denial_reason: Optional[str] = None

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
    user: dict = Depends(require_admin),
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

    session_id = case["help_session_id"]
    session = await db.tactical_sessions.find_one(
        {"id": session_id},
        {"_id": 0},
    )
    if not session:
        raise HTTPException(
            status_code=404,
            detail="Live support session not found.",
        )

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
            f"Live support session ended by {user['username']}."
            f"\n\nTranscript:\n{transcript}"
        ),
        author=user["username"],
        kind="support",
        created_at=ts,
    )

    await db.tactical_sessions.update_one(
        {"id": session_id},
        {
            "$set": {
                "active": False,
                "cleared_by": user["username"],
                "cleared_at": ts,
            }
        },
    )

    thread_id = str(case.get("help_discord_channel_id") or "").strip()
    if thread_id and DISCORD_BOT_TOKEN:
        headers = {
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
            "Content-Type": "application/json",
        }
        # Archive and lock the Discord support thread. If the bot lacks
        # Manage Threads for locking, retry with archive-only.
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
        {"id": case["id"]},
        {
            "$set": {
                "help_session_active": False,
                "help_discord_status": "ended",
                "updated_at": ts,
            },
            "$push": {"notes": entry.model_dump()},
        },
    )

    updated = await db.cases.find_one(
        {"id": case["id"]},
        {"_id": 0},
    )
    return {
        "message": "Live support session ended.",
        "case": updated,
        "transcript": transcript,
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