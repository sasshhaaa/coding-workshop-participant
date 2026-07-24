import { useState } from "react";
import {
  Box, Card, CardContent, TextField, Button, Typography, Stack,
  Alert, Tabs, Tab, CircularProgress,
} from "@mui/material";
import { authApi, setToken, authError } from "../services/auth";

export default function Login({ onSignedIn }) {
  const [tab, setTab] = useState(0); // 0 = sign in, 1 = create account

  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const finish = (result) => {
    setToken(result.token);
    onSignedIn(result.user);
  };

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = () => run(async () => {
    finish(await authApi.login(form.email, form.password));
  });

  const register = () => run(async () => {
    finish(await authApi.register({
      email: form.email,
      name: form.name,
      password: form.password,
    }));
  });

  const onKeyDown = (e, action) => {
    if (e.key === "Enter" && !busy) action();
  };

  const switchTab = (_, v) => {
    setTab(v);
    setError("");
  };

  return (
    <Box
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        overflowY: "auto",
        px: 2,
        py: 4,
      }}
    >
      <Card
        elevation={0}
        sx={{ width: "100%", maxWidth: 420, mx: "auto", textAlign: "left" }}
      >
        <Box sx={{ bgcolor: "primary.dark", px: 3, py: 2.5 }}>
          <Stack direction="row" justifyContent="space-between"
            alignItems="flex-start" gap={2}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1"
                sx={{ color: "#fff", fontWeight: 600 }}>
                ACME team management
              </Typography>
              <Typography variant="caption"
                sx={{ color: "rgba(255,255,255,0.75)" }}>
                Sign in to view and manage your organisation
              </Typography>
            </Box>

            {/* The logo is navy, so it's inverted to white for the dark panel. */}
            <Box
              component="img"
              src="/citi-logo.svg"
              alt="Citi"
              sx={{
                height: 22,
                flexShrink: 0,
                mt: 0.5,
                filter: "brightness(0) invert(1)",
              }}
            />
          </Stack>
        </Box>

        {/* Both tabs and both submit buttons share their labels, so the tests
            target ids rather than visible text. Ids are used instead of
            data attributes because MUI v9 no longer forwards inputProps to
            the underlying element, but id always reaches it — and it also
            links the label to the field, which helps screen readers. */}
        <Tabs value={tab} onChange={switchTab} variant="fullWidth">
          <Tab label="Sign in" id="tab-signin" />
          <Tab label="Create account" id="tab-register" />
        </Tabs>

        <CardContent sx={{ p: 3 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} id="auth-error">
              {error}
            </Alert>
          )}

          {tab === 0 && (
            <Stack spacing={2.5}>
              <TextField
                id="signin-email"
                label="Email" type="email" value={form.email}
                onChange={set("email")} onKeyDown={(e) => onKeyDown(e, signIn)}
                autoFocus fullWidth
              />
              <TextField
                id="signin-password"
                label="Password" type="password" value={form.password}
                onChange={set("password")} onKeyDown={(e) => onKeyDown(e, signIn)}
                fullWidth
              />
              <Button
                id="submit-signin"
                variant="contained" onClick={signIn} disabled={busy} fullWidth
                startIcon={busy ? <CircularProgress size={16} /> : null}
              >
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </Stack>
          )}

          {tab === 1 && (
            <Stack spacing={2.5}>
              <TextField
                id="register-name"
                label="Full name" value={form.name}
                onChange={set("name")} autoFocus fullWidth
              />
              <TextField
                id="register-email"
                label="Email" type="email" value={form.email}
                onChange={set("email")} fullWidth
              />
              <TextField
                id="register-password"
                label="Password" type="password" value={form.password}
                onChange={set("password")}
                onKeyDown={(e) => onKeyDown(e, register)}
                helperText="At least 8 characters" fullWidth
              />
              <Alert severity="info" sx={{ py: 0.5 }}>
                New accounts start with read-only access. An admin can grant you
                more.
              </Alert>
              <Button
                id="submit-register"
                variant="contained" onClick={register}
                disabled={busy} fullWidth
              >
                {busy ? "Creating…" : "Create account"}
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}