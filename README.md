## Core Features

* **Authentication and Security:** Stateless user authentication driven by JSON Web Tokens (JWT) paired with Multi-Factor Authentication (MFA) via Time-based One-Time Password (TOTP) protocols, requiring cryptographic six-digit token verification from authenticator applications during login.
* **Credential Encryption:** Robust data protection utilizing cryptographic hashing functions to secure user passwords prior to database persistence, mitigating risks associated with credential exposure.
* **Ledger Integrity and Balance Tracking:** A real-time balance engine and historical transaction ledger governed by ACID-compliant database operations, guaranteeing atomic balance updates during user-to-user transfers to prevent financial inconsistencies and race conditions.

## Walkthrough
https://github.com/user-attachments/assets/a01740c9-2280-47db-b5ae-4b47fa1c82e5

## Deployment and Installation

### Prerequisites

Ensure you have Docker and Docker Compose installed on your machine:
* [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/khyahahati/digital-wallet
   cd digital-wallet

2. **Build and launch the containerized ecosystem using Docker Compose:**
   ```bash
   docker compose up --build
3. **Access the application components via the following local endpoints:**
   * Frontend Interface: http://localhost:3000
   * Backend API Gateway: http://localhost:8080
   * PostgreSQL Database Instance: localhost:5432
