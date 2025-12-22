package logger

import (
	"context"
	"log"
)

type Logger interface {
	Debug(msg string, keysAndValues ...any)
	Info(msg string, keysAndValues ...any)
	Warn(msg string, keysAndValues ...any)
	Error(msg string, keysAndValues ...any)
	Fatal(msg string, keysAndValues ...any)
}

type noOpLogger struct{}

func (n *noOpLogger) Debug(msg string, keysAndValues ...any) {}
func (n *noOpLogger) Info(msg string, keysAndValues ...any)  {}
func (n *noOpLogger) Warn(msg string, keysAndValues ...any)  {}
func (n *noOpLogger) Error(msg string, keysAndValues ...any) {}
func (n *noOpLogger) Fatal(msg string, keysAndValues ...any) {}

type contextKey string

const loggerKey contextKey = "logger"

func WithLogger(ctx context.Context, logger Logger) context.Context {
	return context.WithValue(ctx, loggerKey, logger)
}

func FromContext(ctx context.Context) Logger {
	log.Println("WARN using no op logger")
	if logger, ok := ctx.Value(loggerKey).(Logger); ok {
		return logger
	}
	return &noOpLogger{}
}
