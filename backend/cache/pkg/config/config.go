package config

import (
	"log"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type (
	Config struct {
		HTTP           HTTP      `envPrefix:"HTTP_"`
		Logger         Logger    `envPrefix:"LOGGER_"`
		Telemetry      Telemetry `envPrefix:"TELEMETRY_"`
		Redis          Redis     `envPrefix:"REDIS_"`
	}

	HTTP struct {
		Server  Server        `envPrefix:"SERVER_"`
		Timeout time.Duration `envPrefix:"TIMEOUT" envDefault:"10s"`
	}

	Server struct {
		Port         string        `env:"PORT,required"`
		ReadTimeout  time.Duration `env:"READ_TIMEOUT" envDefault:"15s"`
		WriteTimeout time.Duration `env:"WRITE_TIMEOUT" envDefault:"15s"`
		IdleTimeout  time.Duration `env:"IDLE_TIMEOUT" envDefault:"60s"`
	}

	Logger struct {
		Level string `env:"LEVEL,required"`
	}

	Telemetry struct {
		Enabled         bool   `env:"ENABLED" envDefault:"false"`
		ServiceName     string `env:"SERVICE_NAME" envDefault:"guide-helper-cache"`
		ServiceVersion  string `env:"SERVICE_VERSION" envDefault:"1.0.0"`
		Environment     string `env:"ENVIRONMENT" envDefault:"production"`
		OTLPEndpoint    string `env:"OTLP_ENDPOINT" envDefault:"otel-collector.observability.svc.cluster.local:4317"`
	}

	Redis struct {
		Enabled  bool          `env:"ENABLED" envDefault:"false"`
		Addr     string        `env:"ADDR" envDefault:"localhost:6379"`
		Password string        `env:"PASSWORD" envDefault:""`
		DB       int           `env:"DB" envDefault:"0"`
		TTL      time.Duration `env:"TTL" envDefault:"24h"`
	}
)

func New() (*Config, error) {
	err := godotenv.Load()
	if err != nil {
		log.Printf("NOTICE: .env file not found or cannot be loaded: %v\n", err)
	}

	cfg, err := env.ParseAs[Config]()
	if err != nil {
		return nil, err
	}

	return &cfg, nil
}
