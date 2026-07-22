import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Card, CardContent, Alert, CircularProgress,
  Chip, Stack, Divider, TextField, InputAdornment, Button,
  IconButton, Snackbar,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useMediaQuery } from "react-responsive";
import { teamsApi, individualsApi, apiError } from "../services/api";
import EntityDialog from "../components/EntityDialog";

function Metric({ label, value, tone = "default" }) {
  const tones = {
    default: { bg: "grey.100", fg: "text.primary" },
    warning: { bg: "warning.light", fg: "warning.dark" },
    danger: { bg: "error.light", fg: "error.dark" },
  };
  const t = tones[tone];
  return (
    <Card elevation={0} sx={{ bgcolor: t.bg, borderRadius: 2, flex: 1, minWidth: 130 }}>
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="caption" sx={{ color: t.fg }}>{label}</Typography>
        <Typography variant="h5" sx={{ color: t.fg, fontWeight: 500 }}>{value}</Typography>
      </CardContent>
    </Card>
  );
}

export default function Dashboard({ onSelectTeam }) {
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState(null);
  const isMobile = useMediaQuery({ maxWidth: 768 });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [analytics, individuals] = await Promise.all([
        teamsApi.analytics(),
        individualsApi.getAll(),
      ]);
      setData(analytics);
      setPeople(individuals);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fields = [
    { name: "name", label: "Team name", required: true },
    { name: "location", label: "Location", required: true },
    {
      name: "leader_id", label: "Team leader",
      options: [
        { value: "", label: "No leader" },
        ...people.map((p) => ({ value: p.id, label: `${p.name} (${p.location})` })),
      ],
    },
    { name: "org_leader", label: "Reports to", help: "Organisation leader name" },
  ];

  const save = async (form) => {
    try {
      if (dialog?.id) {
        await teamsApi.update(dialog.id, form);
        setToast("Team updated");
      } else {
        await teamsApi.create(form);
        setToast("Team created");
      }
      load();
    } catch (e) {
      throw apiError(e);
    }
  };

  const remove = async (id, name) => {
    if (!window.confirm(`Delete "${name}"? Its achievements will also be removed.`)) return;
    try {
      await teamsApi.remove(id);
      setToast("Team deleted");
      load();
    } catch (e) {
      setError(apiError(e));
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" p={6}><CircularProgress /></Box>;
  }

  const teams = (data?.teams || []).filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.location || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Box sx={{ p: isMobile ? 1 : 0 }}>
      <Typography variant="h6" mb={2}>Organisation health</Typography>

      {error && <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>{error}</Alert>}

      <Stack direction="row" flexWrap="wrap" gap={1.5} mb={1.5}>
        <Metric label="Teams" value={data.total_teams} />
        <Metric label="People" value={data.total_people} />
        <Metric label="Locations" value={data.locations} />
        <Metric label="Reporting to org lead" value={data.reporting_to_org_leader} />
      </Stack>

      <Stack direction="row" flexWrap="wrap" gap={1.5} mb={3}>
        <Metric label="Leader not co-located" value={data.leader_not_colocated} tone="warning" />
        <Metric label="Non-direct leader" value={data.leader_non_direct} tone="warning" />
        <Metric label="Non-direct over 20%" value={data.non_direct_over_20pct} tone="danger" />
      </Stack>

      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} mb={1} flexWrap="wrap">
        <Typography variant="subtitle2">Teams</Typography>
        <Stack direction="row" gap={1}>
          <TextField
            size="small" placeholder="Search teams" value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
              ),
            }}
          />
          <Button variant="contained" size="small" startIcon={<AddIcon />}
            onClick={() => setDialog({})}>
            New team
          </Button>
        </Stack>
      </Stack>

      {teams.length === 0 && (
        <Typography variant="body2" color="text.secondary" py={3}>
          {search ? "No teams match your search." : "No teams yet. Create one to get started."}
        </Typography>
      )}

      {teams.map((t) => (
        <Box key={t.id}>
          <Divider />
          <Stack direction="row" alignItems="center" gap={1} py={1.5}>
            <Box
              flex={1} minWidth={0}
              onClick={() => onSelectTeam(t.id)}
              sx={{ cursor: "pointer" }}
            >
              <Typography variant="body2">{t.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t.location} · {t.member_count} people
                {t.leader_name ? ` · led by ${t.leader_name}` : " · no leader"}
              </Typography>
            </Box>
            {t.leader_offsite && (
              <Chip label="Remote lead" size="small" color="warning" variant="outlined" />
            )}
            <Chip
              label={`${t.non_direct_pct ?? 0}% non-direct`}
              size="small"
              color={Number(t.non_direct_pct) > 20 ? "error" : "default"}
              variant={Number(t.non_direct_pct) > 20 ? "filled" : "outlined"}
            />
            <IconButton size="small" onClick={() => setDialog(t)}>
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" color="error" onClick={() => remove(t.id, t.name)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>
      ))}

      <EntityDialog
        open={!!dialog}
        title={dialog?.id ? "Edit team" : "New team"}
        fields={fields}
        initial={dialog?.id ? {
          name: dialog.name, location: dialog.location,
          leader_id: dialog.leader_id ?? "", org_leader: dialog.org_leader ?? "",
        } : { name: "", location: "", leader_id: "", org_leader: "" }}
        onClose={() => setDialog(null)}
        onSave={save}
      />

      <Snackbar open={!!toast} autoHideDuration={3000}
        onClose={() => setToast("")} message={toast} />
    </Box>
  );
}