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
		DB             DB        `envPrefix:"DB_"`
		Logger         Logger    `envPrefix:"LOGGER_"`
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

	DB struct {
		Host               string `env:"HOST,required"`
		Port               string `env:"PORT,required"`
		User               string `env:"USER,required"`
		Password           string `env:"PASSWORD,required"`
		Name               string `env:"NAME,required"`
		Charset            string `env:"CHARSET" envDefault:"utf8mb4"`
		Collation          string `env:"COLLATION" envDefault:"utf8mb4_unicode_ci"`
		MaxIdleConnections int    `env:"MAX_IDLE_CONNECTIONS" envDefault:"2"`
		MaxOpenConnections int    `env:"MAX_OPEN_CONNECTIONS" envDefault:"0"`
	}

	Logger struct {
		Level string `env:"LEVEL,required"`
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
