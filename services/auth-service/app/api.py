from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

from app.database import get_db_service
from app.security import create_access_token, hash_password, jwks, require_auth, TokenPayload, verify_password

router = APIRouter()


class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    created_at: datetime
    updated_at: datetime


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


@router.get("/jwks.json")
async def get_jwks():
    return jwks()


@router.get("/.well-known/jwks.json")
async def get_jwks_well_known():
    return jwks()


@router.post("/register", response_model=UserResponse)
async def register(request: RegisterRequest):
    email = (request.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    if not request.password:
        raise HTTPException(status_code=400, detail="Password required")

    db = await get_db_service()
    existing = await db.get_user_by_email(email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already exists")

    user_id = str(uuid.uuid4())
    user = await db.create_user(
        user_id=user_id,
        name=request.name.strip() or "user",
        email=email,
        password_hash=hash_password(request.password),
        role="user",
    )

    return UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest):
    email = (request.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    db = await get_db_service()
    user = await db.get_user_by_email(email)
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user_id=user.id, role=user.role)
    return AuthResponse(
        access_token=token,
        user=UserResponse(
            id=user.id,
            name=user.name,
            email=user.email,
            role=user.role,
            created_at=user.created_at,
            updated_at=user.updated_at,
        ),
    )


@router.get("/me", response_model=UserResponse)
async def me(payload: TokenPayload = Depends(require_auth)):
    db = await get_db_service()
    user = await db.get_user_by_id(payload.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )
