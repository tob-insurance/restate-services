# Restate Monorepo

This repository is a **Monorepo** managed by [Turborepo](https://turbo.build/) and [pnpm workspaces](https://pnpm.io/workspaces). It is designed to host multiple Restate services/workflows for different applications in a single repository.

## 📂 Project Structure

```
/
├── apps/
│   ├── finance/          # Finance Application (Closing Workflow, etc.)
│   ├── [new-app]/        # Future applications (e.g., hr, inventory)
│   └── ...
├── packages/             # Shared libraries (optional, for shared code)
├── package.json          # Root configuration
├── pnpm-workspace.yaml   # Workspace definition
└── turbo.json            # Turborepo pipeline config
```

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- pnpm (`npm install -g pnpm`)
- Restate Server running locally

### Installation
Install dependencies for all apps:
```bash
pnpm install
```

### Running All Services
Start all applications in development mode simultaneously:
```bash
pnpm dev
```

## ➕ How to Add a New Application

To add a new service/workflow for a different domain (e.g., HR, Inventory):

1.  **Create a new folder** in `apps/`:
    ```bash
    mkdir apps/hr
    ```

2.  **Initialize the app** (or copy from `apps/finance` as a template):
    - Ensure it has its own `package.json`.
    - Name the package uniquely, e.g., `@hr/service`.

3.  **Install dependencies**:
    Run `pnpm install` from the root.

4.  **Run**:
    The new app will automatically be included when you run `pnpm dev` from the root, provided its `package.json` has a `dev` script.

## 🛠️ Commands

| Command | Description |
| :--- | :--- |
| `pnpm dev` | Start all apps in watch mode |
| `pnpm build` | Build all apps |
| `pnpm lint` | Lint all apps |
| `pnpm clean` | Clean build artifacts |

## 📦 Deployment

Each application in `apps/` is independent and can be deployed separately (e.g., as individual Docker containers).
