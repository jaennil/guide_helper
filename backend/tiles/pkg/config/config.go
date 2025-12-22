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
		Cache          Cache     `envPrefix:"CACHE_"`
		Upstream       Upstream  `envPrefix:"UPSTREAM_"`
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

	Cache struct {
		BaseURL string `env:"BASE_URL" envDefault:"http://cache:8080"`
	}

	Upstream struct {
		TileServerURL string `env:"TILE_SERVER_URL" envDefault:"https://tile.openstreetmap.org"`
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
