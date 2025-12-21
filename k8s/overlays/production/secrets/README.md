# Secrets Setup

Before deploying, create the actual secret files (without `.example` extension):

```bash
cd k8s/overlays/production/secrets

# Copy examples and edit with your values
cp postgres-user.txt.example postgres-user.txt
cp postgres-password.txt.example postgres-password.txt
cp postgres-db.txt.example postgres-db.txt
cp jwt-secret.txt.example jwt-secret.txt

# Edit each file with actual secrets
# postgres-password.txt: Strong password for PostgreSQL
# jwt-secret.txt: Random string, minimum 32 characters

# Generate strong JWT secret:
openssl rand -base64 48 > jwt-secret.txt
```

**Important**: The actual secret files (`*.txt` without `.example`) are in `.gitignore` and should NEVER be committed to git.
