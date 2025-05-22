# Next Phase Development Plan

This document outlines the remaining steps to deliver the full document processing application. The goal is a containerized stack that allows users to upload documents via a React UI, extracts text using Apache Tika, stores data in PostgreSQL and runs tests via GitHub Actions.

## Overview of Current State

- **Backend**: Express + TypeScript service capable of accepting uploads and forwarding them to Apache Tika. The code persists documents and extracted text to PostgreSQL.
- **Frontend**: React application generated with Create React App. Currently minimal with no upload form.
- **Docker Compose**: Defines services for backend, frontend, Postgres and Tika. Backend container already has a Dockerfile. Frontend container image is not defined yet.
- **Testing**: No automated tests or CI configured.

## Objectives for Phase 2

1. **Frontend Upload UI**
   - Add a simple form allowing users to select a file and POST it to `/api/upload`.
   - Show upload progress and display the extracted text once processing completes.
   - Handle errors such as invalid file types or server failures.

2. **Backend Enhancements**
   - Replace plain `console.log` statements with a structured logging library (e.g. `winston`).
   - Add validation around uploads (limit file size, enforce required field `document`).
   - Provide an endpoint for listing all uploaded documents and their status.

3. **Docker and Kubernetes**
   - Create a `frontend/Dockerfile` and update `docker-compose.yml` to build and run the React application in a container.
   - Prepare Kubernetes manifests (Deployment, Service, Ingress) for backend and frontend for future deployment.

4. **Testing Strategy**
   - Use **Jest** for unit tests in the backend (DB functions, route handlers) and integration tests against a running test database.
   - Use **Playwright** for end‑to‑end tests covering the upload flow in the UI.
   - Configure `package.json` scripts in both projects to run these tests.
   - Aim for at least **80%** code coverage verified via Jest's coverage reports.
   - Add GitHub Actions workflow to install dependencies, run lint, and execute Jest and Playwright suites on every pull request.

5. **Documentation**
   - Expand the root `README.md` with setup instructions, environment variables and local development workflow.
   - Document how to run the stack via Docker Compose and where to access each service.
   - Provide a short guide on deploying to Kubernetes using the manifests from step 3.

## Recommended File Layout

```
/docs                Project documentation
/frontend            React application
/backend             Express API
/k8s                 Kubernetes manifests
```

## Milestones

1. Build the upload form in the React app and verify manual file uploads work against the running backend.
2. Introduce structured logging and an additional API endpoint for listing documents.
3. Containerize the frontend and confirm the Docker Compose stack works end‑to‑end.
4. Add automated Jest and Playwright tests. Verify GitHub Actions runs them on push.
5. Create Kubernetes manifests and document deployment steps.

Completion of these tasks will deliver a functional, testable, containerized application ready for enterprise deployment.
