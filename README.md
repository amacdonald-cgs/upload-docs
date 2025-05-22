# Document Processing Application

This repository contains a proof‑of‑concept for uploading documents, extracting text with Apache Tika and storing results in PostgreSQL. The project consists of a React frontend and an Express/TypeScript backend.

## Repository Layout

- `backend/` – Express API handling uploads and persisting data
- `frontend/` – React application (Create React App)
- `docker-compose.yml` – Development stack including Postgres and Apache Tika
- `docs/` – Design documents and plans

## Running Locally with Docker Compose

Ensure Docker and Docker Compose are installed. From the project root run:

```bash
docker-compose up --build
```

The backend will be available at `http://localhost:3001` and the frontend at `http://localhost:3000`.

## Running Tests

Unit and integration tests are implemented with [Jest](https://jestjs.io/).
Run tests from the project root using:

```bash
npm test --prefix backend
```

Coverage reports are generated automatically and a global threshold of 80% is
enforced.

## Development Plan

The next steps for completing the application are outlined in [docs/phase2_plan.md](docs/phase2_plan.md). This includes adding an upload form, containerizing the frontend, implementing tests and setting up CI with GitHub Actions.

## License

This project is licensed under the terms of the MIT license. See [LICENSE](LICENSE) for details.
