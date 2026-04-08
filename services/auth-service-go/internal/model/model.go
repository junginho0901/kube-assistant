package model

import (
	"encoding/json"
	"time"
)

// User represents an auth_users row.
type User struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	HQ           *string   `json:"hq"`
	Team         *string   `json:"team"`
	Role         string    `json:"role"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// UserResponse is the public API representation (no password hash).
type UserResponse struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	HQ        *string   `json:"hq"`
	Team      *string   `json:"team"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (u *User) ToResponse() UserResponse {
	return UserResponse{
		ID:        u.ID,
		Name:      u.Name,
		Email:     u.Email,
		HQ:        u.HQ,
		Team:      u.Team,
		Role:      u.Role,
		CreatedAt: u.CreatedAt,
		UpdatedAt: u.UpdatedAt,
	}
}

// AuditLog represents an auth_audit_logs row.
type AuditLog struct {
	ID           int              `json:"id"`
	Action       string           `json:"action"`
	ActorUserID  *string          `json:"actor_user_id"`
	ActorEmail   *string          `json:"actor_email"`
	TargetUserID *string          `json:"target_user_id"`
	TargetEmail  *string          `json:"target_email"`
	Before       *json.RawMessage `json:"before"`
	After        *json.RawMessage `json:"after"`
	RequestIP    *string          `json:"request_ip"`
	UserAgent    *string          `json:"user_agent"`
	RequestID    *string          `json:"request_id"`
	Path         *string          `json:"path"`
	CreatedAt    time.Time        `json:"created_at"`
}

// ClusterSetup represents a cluster_setup row.
type ClusterSetup struct {
	ID         int       `json:"id"`
	Mode       string    `json:"mode"`
	SecretName *string   `json:"secret_name"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Organization represents an organizations row (HQ or Team).
type Organization struct {
	ID        int       `json:"id"`
	Type      string    `json:"type"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// --- Request DTOs ---

type RegisterRequest struct {
	Name     string  `json:"name"`
	Email    string  `json:"email"`
	Password string  `json:"password"`
	HQ       *string `json:"hq,omitempty"`
	Team     *string `json:"team,omitempty"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type UpdateRoleRequest struct {
	Role string `json:"role"`
}

type AdminCreateUserRequest struct {
	Name     string  `json:"name"`
	Email    string  `json:"email"`
	Password string  `json:"password"`
	Role     string  `json:"role"`
	HQ       *string `json:"hq,omitempty"`
	Team     *string `json:"team,omitempty"`
}

type BulkUpdateRoleRequest struct {
	UserIDs []string `json:"user_ids"`
	Role    string   `json:"role"`
}

type BulkCreateUserRequest struct {
	Users []AdminCreateUserRequest `json:"users"`
}

type BulkCreateUserResponse struct {
	Created []UserResponse `json:"created"`
	Errors  []BulkError    `json:"errors"`
}

type BulkError struct {
	Email   string `json:"email"`
	Message string `json:"message"`
}

type ClusterSetupRequest struct {
	Mode       string  `json:"mode"`
	Kubeconfig *string `json:"kubeconfig,omitempty"`
}

// --- Response DTOs ---

type LoginResponse struct {
	AccessToken string       `json:"access_token"`
	TokenType   string       `json:"token_type"`
	User        UserResponse `json:"user"`
}

type ClusterSetupStatus struct {
	Configured        bool    `json:"configured"`
	Mode              string  `json:"mode,omitempty"`
	SecretName        *string `json:"secret_name,omitempty"`
	ConnectionStatus  string  `json:"connection_status,omitempty"`
	ConnectionMessage *string `json:"connection_message,omitempty"`
}
