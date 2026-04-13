package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/pbkdf2"
)

const (
	pbkdf2Alg = "pbkdf2_sha256"
	saltBytes = 16
	dkLen     = 32 // SHA256 output length
)

// HashPassword creates a PBKDF2-SHA256 hash compatible with the Python implementation.
// Format: pbkdf2_sha256$iterations$salt_b64$dk_b64
func HashPassword(password string, iterations int) (string, error) {
	salt := make([]byte, saltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}

	dk := pbkdf2.Key([]byte(password), salt, iterations, dkLen, sha256.New)

	saltB64 := base64.RawURLEncoding.EncodeToString(salt)
	dkB64 := base64.RawURLEncoding.EncodeToString(dk)

	return fmt.Sprintf("%s$%d$%s$%s", pbkdf2Alg, iterations, saltB64, dkB64), nil
}

// GenerateRandomPassword returns a cryptographically random alphanumeric
// string of the requested length using crypto/rand. Used for admin
// reset-password and bootstrap fallbacks where the plaintext is shown
// to a human exactly once.
func GenerateRandomPassword(length int) (string, error) {
	if length <= 0 {
		length = 16
	}
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	out := make([]byte, length)
	for i, b := range buf {
		out[i] = charset[int(b)%len(charset)]
	}
	return string(out), nil
}

// VerifyPassword checks a password against a stored PBKDF2-SHA256 hash.
// Timing-safe comparison to prevent timing attacks.
func VerifyPassword(password, stored string) bool {
	if password == "" || stored == "" {
		return false
	}

	parts := strings.SplitN(stored, "$", 4)
	if len(parts) != 4 || parts[0] != pbkdf2Alg {
		return false
	}

	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations <= 0 {
		return false
	}

	salt, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}

	expected, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}

	actual := pbkdf2.Key([]byte(password), salt, iterations, len(expected), sha256.New)
	return hmac.Equal(actual, expected)
}

