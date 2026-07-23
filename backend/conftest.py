"""Shared pytest setup for the backend services.

Two things every service's tests need:

1. `backend/` on the import path, so `import auth_guard` resolves. The router
   does this at startup and the deploy script copies the module into each
   Lambda bundle, but pytest knows about neither.
2. Authorisation switched off. These are unit tests of business logic, not of
   the guard — the guard has its own tests. Leaving it on would mean every
   handler test had to mint a token first, which tests the wrong thing.
"""

import os
import sys

BACKEND = os.path.dirname(os.path.abspath(__file__))

if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

os.environ.setdefault("AUTH_ENFORCED", "false")