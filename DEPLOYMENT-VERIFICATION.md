# Deployment verification

This file is a non-runtime trigger used to verify the secure deployment
pipeline for Ironhex after configuring the Komodo GitHub Actions secrets.

A push to `main` triggers Ironhex CI, Chromium E2E and Container Smoke.
After all three pass for the same commit, the deployment workflow attempts
to call the private, HMAC-authenticated Komodo stack webhook.

This document is excluded from the runtime Docker build and does not change
the application or its database schema.
