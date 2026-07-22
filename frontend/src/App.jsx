import { createTheme, ThemeProvider, CssBaseline } from "@mui/material";
import { AppBar, Toolbar, Typography, Container } from "@mui/material";
import Projects from "./pages/Projects";

const theme = createTheme({
  palette: {
    primary: { main: "#1565c0" },
    background: { default: "#f5f7fa" },
  },
  shape: { borderRadius: 8 },
});

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6">ACME Project Tracker</Typography>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ mt: 3 }}>
        <Projects />
      </Container>
    </ThemeProvider>
  );
}