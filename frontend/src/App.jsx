import { useState, useEffect } from "react";
import {
  ThemeProvider, CssBaseline, GlobalStyles, AppBar, Toolbar,
  Typography, Box, Chip, Button, Stack, CircularProgress,
  Avatar, IconButton, Menu, Divider, Tooltip,
} from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import theme from "./theme";
import Dashboard from "./pages/Dashboard";
import TeamDetail from "./pages/TeamDetail";
import Login from "./pages/Login";
import { authApi, getToken, setToken } from "./services/auth";

// Cancels the width cap and centring that ship with Vite's starter CSS.
const resetLayout = (
  <GlobalStyles
    styles={{
      "html, body": {
        width: "100%",
        margin: 0,
        padding: 0,
        display: "block",
        placeItems: "normal",
      },
      "#root": {
        width: "100%",
        maxWidth: "none",
        margin: 0,
        padding: 0,
        textAlign: "left",
        display: "block",
      },
    }}
  />
);

const initials = (name = "") =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const ROLE_BLURB = {
  admin: "Full access, including user management",
  manager: "Can create, edit, and delete records",
  contributor: "Can create and edit, but not delete",
  viewer: "Read-only access",
};

function AccountMenu({ user, onSignOut }) {
  const [anchor, setAnchor] = useState(null);

  return (
    <>
      <Tooltip title="Account" arrow>
        <IconButton
          onClick={(e) => setAnchor(e.currentTarget)}
          size="small"
          aria-label="Open account menu"
          sx={{
            p: 0.5,
            border: 2,
            borderColor: anchor ? "#fff" : "rgba(255,255,255,0.35)",
            "&:hover": { borderColor: "#fff", bgcolor: "transparent" },
          }}
        >
          <Avatar
            sx={{
              width: 32, height: 32, fontSize: 13, fontWeight: 600,
              bgcolor: "#fff", color: "primary.dark",
            }}
          >
            {initials(user.name)}
          </Avatar>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { mt: 1, minWidth: 260, borderRadius: 2 } } }}
      >
        <Box sx={{ px: 2, py: 1.75 }}>
          <Stack direction="row" gap={1.5} alignItems="center" sx={{ mb: 1.5 }}>
            <Avatar
              sx={{
                width: 40, height: 40, fontSize: 14, fontWeight: 600,
                bgcolor: "primary.main",
              }}
            >
              {initials(user.name)}
            </Avatar>
            <Box minWidth={0}>
              <Typography variant="body2" fontWeight={600} noWrap>
                {user.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap
                sx={{ display: "block" }}>
                {user.email}
              </Typography>
            </Box>
          </Stack>

          <Chip
            label={user.role}
            size="small"
            color={user.role === "admin" ? "primary" : "default"}
            sx={{ mb: 0.75 }}
          />
          <Typography variant="caption" color="text.secondary"
            sx={{ display: "block" }}>
            {ROLE_BLURB[user.role] || ""}
          </Typography>
        </Box>

        <Divider />

        <Box sx={{ p: 1 }}>
          <Button
            fullWidth
            size="small"
            startIcon={<LogoutIcon />}
            onClick={() => { setAnchor(null); onSignOut(); }}
            sx={{ justifyContent: "flex-start", color: "error.main" }}
          >
            Sign out
          </Button>
        </Box>
      </Menu>
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [teamId, setTeamId] = useState(null);

  useEffect(() => {
    if (!getToken()) {
      setChecking(false);
      return;
    }
    authApi.me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  const signOut = () => {
    setToken(null);
    setUser(null);
    setTeamId(null);
  };

  if (checking) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {resetLayout}
        <Box sx={{ display: "flex", justifyContent: "center", pt: 12 }}>
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }

  if (!user) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {resetLayout}
        <Login onSignedIn={setUser} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {resetLayout}

      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ minHeight: 60, px: { xs: 2, md: 4 }, gap: 2 }}>
          <Typography variant="subtitle1"
            sx={{ fontWeight: 600, letterSpacing: "-0.01em", flex: 1 }}>
            ACME team management
          </Typography>

          <AccountMenu user={user} onSignOut={signOut} />
        </Toolbar>
      </AppBar>

      <Box sx={{ width: "100%", px: { xs: 2, md: 4 }, mt: 3, pb: 8 }}>
        {teamId
          ? <TeamDetail teamId={teamId} user={user}
              onBack={() => setTeamId(null)} />
          : <Dashboard user={user} onSelectTeam={setTeamId} />}
      </Box>
    </ThemeProvider>
  );
}