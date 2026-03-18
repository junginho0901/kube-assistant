package logger

import (
	"log/slog"
	"os"
)

// Setup initializes the global structured logger.
func Setup(service string, debug bool) *slog.Logger {
	level := slog.LevelInfo
	if debug {
		level = slog.LevelDebug
	}

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	})

	logger := slog.New(handler).With("service", service)
	slog.SetDefault(logger)
	return logger
}
