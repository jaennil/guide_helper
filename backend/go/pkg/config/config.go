package config

import "time"

type (
	Config struct {
		HTTP HTTP `envPrefix:"HTTP_"`
	}

	HTTP struct {
		Server  HTTPServer    `envPrefix:"SERVER_"`
		Timeout time.Duration `env:"TIMEOUT,required"`
	}

	HTTPServer struct {
		Port         string        `env:"PORT,required"`
		ReadTimeout  time.Duration `env:"READ_TIMEOUT,required"`
		WriteTimeout time.Duration `env:"WRITE_TIMEOUT,required"`
		IdleTimeout  time.Duration `env:"IDLE_TIMEOUT,required"`
	}
)
