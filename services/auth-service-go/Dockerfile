## Build stage
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git

# Copy shared pkg first (for layer caching)
WORKDIR /build/pkg
COPY pkg/go.mod pkg/go.sum* ./
COPY pkg/ ./

# Copy auth-service-go
WORKDIR /build/auth-service-go
COPY auth-service-go/go.mod auth-service-go/go.sum* ./

# Fix replace directive for Docker build context
RUN sed -i 's|=> ../pkg|=> /build/pkg|' go.mod

RUN go mod download

COPY auth-service-go/ ./

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/server ./cmd/server

## Runtime stage
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=builder /app/server .

EXPOSE 8004

CMD ["./server"]
