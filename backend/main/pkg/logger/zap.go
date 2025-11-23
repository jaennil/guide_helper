package logger

import (
	"log"

	"github.com/jaennil/guide_helper/main/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type ZapLogger struct {
	logger *zap.SugaredLogger
}

var _ Logger = (*ZapLogger)(nil)

func NewZapLogger(cfg config.Logger) *ZapLogger {
	developmentConfig := zap.NewDevelopmentConfig()

	developmentConfig.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	developmentConfig.EncoderConfig.EncodeCaller = zapcore.ShortCallerEncoder
	developmentConfig.EncoderConfig.CallerKey = "caller"
	developmentConfig.DisableCaller = false
	level := toZapLevel(cfg.Level)
	developmentConfig.Level = zap.NewAtomicLevelAt(level)

	logger, err := developmentConfig.Build(
		zap.AddCaller(),
		zap.AddCallerSkip(1),
	)
	if err != nil {
		log.Fatal("error occurred while building zap logger: ", err)
	}

	sugared := logger.Sugar()

	return &ZapLogger{
		logger: sugared,
	}
}

func toZapLevel(levelStr string) zapcore.Level {
	var level zapcore.Level
	err := level.UnmarshalText([]byte(levelStr))
	if err != nil {
		log.Println("WARN (toZapLevel): failed to unmarshal zap log level from string - using INFO level")
		return zapcore.InfoLevel
	}

	return level
}

func (l *ZapLogger) Debug(msg string, keysAndValues ...any) {
	l.logger.Debugw(msg, keysAndValues...)
}

func (l *ZapLogger) Info(msg string, keysAndValues ...any) {
	l.logger.Infow(msg, keysAndValues...)
}

func (l *ZapLogger) Warn(msg string, keysAndValues ...any) {
	l.logger.Warnw(msg, keysAndValues...)
}

func (l *ZapLogger) Error(msg string, keysAndValues ...any) {
	l.logger.Errorw(msg, keysAndValues...)
}

func (l *ZapLogger) Fatal(msg string, keysAndValues ...any) {
	l.logger.Fatalw(msg, keysAndValues...)
}

func (l *ZapLogger) Sync() error {
	return l.logger.Sync()
}
