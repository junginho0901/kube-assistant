"""
Database models and session management
"""
from datetime import datetime
from typing import Optional, List, Dict, Any

from sqlalchemy import func
from sqlalchemy import Column, String, DateTime, Text, JSON, Integer, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

Base = declarative_base()


class Session(Base):
    """대화 세션"""
    __tablename__ = "sessions"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, default="default")
    title = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    messages = relationship("Message", back_populates="session", cascade="all, delete-orphan")
    context = relationship("SessionContext", back_populates="session", uselist=False, cascade="all, delete-orphan")


class Message(Base):
    """대화 메시지"""
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    role = Column(String, nullable=False)  # user, assistant, tool
    content = Column(Text, nullable=False)
    tool_calls = Column(JSON, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    session = relationship("Session", back_populates="messages")


class SessionContext(Base):
    """세션 컨텍스트 (Tool 실행 상태 저장)"""
    __tablename__ = "session_contexts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False, unique=True)
    state = Column(JSON, nullable=False, default=dict)
    cache = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    session = relationship("Session", back_populates="context")


class DatabaseService:
    def __init__(self, database_url: str = None):
        import os

        if database_url is None:
            database_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./kagent.db")

        self.database_url = database_url
        self.engine = create_async_engine(database_url, echo=False)
        self.async_session = async_sessionmaker(self.engine, class_=AsyncSession, expire_on_commit=False)

    async def init_db(self):
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def create_session(self, session_id: str, user_id: str = "default", title: str = "New Chat") -> Session:
        async with self.async_session() as db:
            session = Session(id=session_id, user_id=user_id, title=title)
            context = SessionContext(session_id=session_id, state={}, cache={})
            db.add(session)
            db.add(context)
            await db.commit()
            await db.refresh(session)
            return session

    async def get_session(self, session_id: str) -> Optional[Session]:
        async with self.async_session() as db:
            from sqlalchemy import select

            result = await db.execute(select(Session).where(Session.id == session_id))
            return result.scalar_one_or_none()

    async def list_sessions_with_message_counts(
        self,
        user_id: str = "default",
        limit: int = 50,
        offset: int = 0,
        before_updated_at: Optional[datetime] = None,
        before_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        async with self.async_session() as db:
            from sqlalchemy import select, and_, or_

            stmt = (
                select(Session, func.count(Message.id).label("message_count"))
                .outerjoin(Message, Message.session_id == Session.id)
                .where(Session.user_id == user_id)
                .group_by(Session.id)
                .order_by(Session.updated_at.desc(), Session.id.desc())
                .limit(limit)
            )

            if before_updated_at is not None:
                if before_id:
                    stmt = stmt.where(
                        or_(
                            Session.updated_at < before_updated_at,
                            and_(Session.updated_at == before_updated_at, Session.id < before_id),
                        )
                    )
                else:
                    stmt = stmt.where(Session.updated_at < before_updated_at)
            else:
                stmt = stmt.offset(offset)

            result = await db.execute(stmt)
            rows = result.all()
            return [
                {"session": session, "message_count": int(message_count or 0)}
                for session, message_count in rows
            ]

    async def update_session_title(self, session_id: str, title: str):
        async with self.async_session() as db:
            from sqlalchemy import update

            await db.execute(
                update(Session)
                .where(Session.id == session_id)
                .values(title=title, updated_at=datetime.utcnow())
            )
            await db.commit()

    async def delete_session(self, session_id: str):
        async with self.async_session() as db:
            from sqlalchemy import select

            result = await db.execute(select(Session).where(Session.id == session_id))
            session = result.scalar_one_or_none()
            if session:
                await db.delete(session)
                await db.commit()

    async def add_message(self, session_id: str, role: str, content: str, tool_calls: Optional[List[Dict]] = None) -> Message:
        async with self.async_session() as db:
            message = Message(session_id=session_id, role=role, content=content, tool_calls=tool_calls)
            db.add(message)

            from sqlalchemy import update

            await db.execute(
                update(Session)
                .where(Session.id == session_id)
                .values(updated_at=datetime.utcnow())
            )

            await db.commit()
            await db.refresh(message)
            return message

    async def get_messages(self, session_id: str, limit: int = 100) -> List[Message]:
        async with self.async_session() as db:
            from sqlalchemy import select

            result = await db.execute(
                select(Message)
                .where(Message.session_id == session_id)
                .order_by(Message.created_at.desc(), Message.id.desc())
                .limit(limit)
            )
            messages = list(result.scalars().all())
            messages.reverse()
            return messages

    async def get_message_count(self, session_id: str) -> int:
        async with self.async_session() as db:
            from sqlalchemy import select

            result = await db.execute(select(func.count(Message.id)).where(Message.session_id == session_id))
            return int(result.scalar_one())

    async def get_context(self, session_id: str) -> Optional[SessionContext]:
        async with self.async_session() as db:
            from sqlalchemy import select

            result = await db.execute(select(SessionContext).where(SessionContext.session_id == session_id))
            return result.scalar_one_or_none()

    async def update_context(self, session_id: str, state: Dict = None, cache: Dict = None):
        async with self.async_session() as db:
            from sqlalchemy import update

            updates = {"updated_at": datetime.utcnow()}
            if state is not None:
                updates["state"] = state
            if cache is not None:
                updates["cache"] = cache

            await db.execute(
                update(SessionContext)
                .where(SessionContext.session_id == session_id)
                .values(**updates)
            )
            await db.commit()


db_service: Optional[DatabaseService] = None


async def get_db_service() -> DatabaseService:
    global db_service
    if db_service is None:
        db_service = DatabaseService()
        await db_service.init_db()
    return db_service

