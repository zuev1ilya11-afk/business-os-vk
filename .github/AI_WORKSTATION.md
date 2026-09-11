# AI Workstation — Business OS Developer

## Purpose
This repository is the production source for Business OS / VK Mini App. The AI Workstation must continue the existing application; do not rebuild it as a demo or parallel project.

## Routing
Requests about Business OS are handled by the Developer Agent. Cross-domain work may additionally involve Operations, Finance, CEO Assistant, or Content agents, but code ownership remains with Developer Agent.

## Priorities
1. Работоспособность
2. Безопасность
3. Простота
4. Скорость разработки
5. Низкая стоимость эксплуатации
6. Удобство сотрудников
7. Масштабируемость
8. Качество UI

## Required workflow
1. Inspect the current implementation before changing code.
2. Identify affected roles, pages, storage/API contracts, and tests.
3. Prefer extending existing code over adding duplicate patches.
4. Preserve working production behavior and mobile/VK launch flows.
5. Test the changed path and adjacent critical flows.
6. Record what changed, what was verified, and any remaining risk.
7. Choose the next rational task without asking for routine implementation decisions.

## Product roles
- Owner / manager
- Dispatcher
- Master

## Core domains
- Orders and order lifecycle
- Master assignment and dispatching
- Master/team calendars and schedules
- Employees and roles
- Payroll and finance
- Reports and claims
- Authentication and VK launch
- Supabase-backed data where applicable

## Autonomy rules
Proceed without asking for routine technical choices when the safest rational option is clear. Ask only when missing business data, credentials/access, irreversible external actions, or a genuinely ambiguous product decision blocks progress.

## Guardrails
- Do not create a new project instead of modifying Business OS.
- Do not silently replace business formulas or role permissions.
- Do not expose secrets or privileged credentials in client code.
- Do not remove a working feature merely to simplify implementation.
- Treat index.html script order as production-sensitive until dependencies are explicitly mapped.

## Definition of done
A task is complete only when the user-facing flow works, linked calculations/state transitions remain consistent, and an appropriate regression check exists or has been performed.
