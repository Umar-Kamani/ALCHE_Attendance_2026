SHELL := /bin/bash
COMPOSE := docker compose
TEST_COMPOSE := docker compose -f docker-compose.yml -f docker-compose.test.yml

.PHONY: up down logs migrate test test-api test-web e2e seed-demo reset-password backup build psql

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=200 app

migrate:
	$(COMPOSE) exec app ./node_modules/.bin/prisma migrate deploy

test: test-api test-web

test-api:
	$(TEST_COMPOSE) --profile test run --rm test-api

test-web:
	$(TEST_COMPOSE) --profile test run --rm test-web

e2e:
	$(COMPOSE) up -d --build
	$(COMPOSE) exec app node dist/seed.js
	$(COMPOSE) exec app node dist/e2e-setup.js
	pnpm exec playwright test

seed-demo:
	$(COMPOSE) exec app node dist/seed.js

reset-password:
	@test -n "$(USER)" || (echo "Usage: make reset-password USER=<username>" && exit 1)
	$(COMPOSE) exec app node dist/cli.js reset-password "$(USER)"

backup:
	./scripts/backup.sh

build:
	$(COMPOSE) build

psql:
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-alche} -d $${POSTGRES_DB:-alche}
