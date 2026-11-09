# The Open3DJ MCP server in a container.
#
# This file is for MCP directories that build a server from a Dockerfile: Glama builds it
# and lists the tools over stdio (https://glama.ai/mcp/methodology, checked 2026-11-05).
# People do not need it. The usual setup is a clone or an installer, then
# `node packages/open3dj/src/cli.ts mcp` (docs/GETTING-STARTED.md).
#
#   docker build -t open3dj-mcp .
#   docker run -i --rm -v /path/to/designs:/work open3dj-mcp
#
# The server speaks MCP over stdin and stdout, so run it with -i. It writes projects to
# /work as the image's non-root `node` user (uid 1000). If your designs folder belongs to
# another user, add --user "$(id -u):$(id -g)" to docker run.
#
# Node 24.22.1 on Debian bookworm, pinned by tag and by the multi-platform index digest
# from Docker Hub (checked 2026-11-08). Update both together.
#
# Checked on 2026-11-08 on Linux x64: the image builds, tools/list over stdio returns the
# five tools, and a run call writes its project to /work.
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c

ENV NODE_ENV=production
WORKDIR /app

# .dockerignore lets in only the package files, the workspace sources, docs/DSL.md (read
# by the docs tool) and LICENSE. Dependencies come from the lockfile at exact
# versions, runtime only, with no install scripts, as the installers do.
COPY . .
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && rm -rf /root/.npm \
 && mkdir /work \
 && chown node:node /work

USER node
WORKDIR /work
ENTRYPOINT ["node", "/app/packages/open3dj/src/cli.ts", "mcp", "--root", "/work"]
