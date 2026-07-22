import { useState } from "react";
import {
  createTheme, ThemeProvider, CssBaseline,
  AppBar, Toolbar, Typography, Container,
} from "@mui/material";
import Dashboard from "./pages/Dashboard";
import TeamDetail from "./pages/TeamDetail";

const theme = createTheme({
  palette: {
    primary: { main: "#1565c0" },
    background: { default: "#f7f8fa" },
  },
  shape: { borderRadius: 8 },
  typography: { fontSize: 14 },
});

export default function App() {
  const [teamId, setTeamId] = useState(null);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static" elevation={0}>
        <Toolbar variant="dense">
          <Typography variant="subtitle1">ACME team management</Typography>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ mt: 3, pb: 6 }}>
        {teamId
          ? <TeamDetail teamId={teamId} onBack={() => setTeamId(null)} />
          : <Dashboard onSelectTeam={setTeamId} />}
      </Container>
    </ThemeProvider>
  );
}