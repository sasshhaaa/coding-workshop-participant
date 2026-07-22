import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, Chip, Stack, Divider, Alert,
  CircularProgress, Avatar, Paper, IconButton, Snackbar,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useMediaQuery } from "react-responsive";
import {
  teamsApi, individualsApi, apiError, LEVELS, STAFF_TYPES,
} from "../services/api";
import EntityDialog from "../components/EntityDialog";

const initials = (name = "") =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function PersonCard({ p, isLead, onEdit, onDelete }) {
  return (
    <Paper elevation={0} sx={{
      p: 1.25, borderRadius: 2, minWidth: 190,
      bgcolor: isLead ? "primary.light" : "grey.100",
    }}>
      <Stack direction="row" gap={1} alignItems="center">
        <Avatar sx={{ width: 28, height: 28, fontSize: 12 }}>{initials(p.name)}</Avatar>
        <Box flex={1} minWidth={0}>
          <Typography variant="body2" noWrap>{p.name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap display="block">
            {p.role || p.level} · {p.location}
          </Typography>
        </Box>
        <IconButton size="small" onClick={() => onEdit(p)}>
          <EditIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <IconButton size="small" color="error" onClick={() => onDelete(p)}>
          <DeleteIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
      {p.staff_type === "non-direct" && (
        <Chip label="Non-direct" size="small" color="warning" sx={{ mt: 0.75 }} />
      )}
    </Paper>
  );
}

function Tier({ label, people, isLead, onEdit, onDelete }) {
  if (!people.length) return null;
  return (
    <Stack direction="row" gap={2} alignItems="flex-start" mb={2}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 62, pt: 1.5 }}>
        {label}
      </Typography>
      <Stack direction="row" gap={1.5} flexWrap="wrap" flex={1}>
        {people.map((p) => (
          <PersonCard key={p.id} p={p} isLead={isLead} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </Stack>
    </Stack>
  );
}

export default function TeamDetail({ teamId, onBack }) {
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [dialog, setDialog] = useState(null);
  const isMobile = useMediaQuery({ maxWidth: 768 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTeam(await teamsApi.getOne(teamId));
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const fields = [
    { name: "name", label: "Full name", required: true },
    { name: "email", label: "Email", required: true, type: "email" },
    { name: "role", label: "Job title" },
    {
      name: "level", label: "Level", required: true,
      options: LEVELS.map((l) => ({ value: l, label: l })),
      help: "Determines position in the hierarchy",
    },
    {
      name: "staff_type", label: "Staff type", required: true,
      options: STAFF_TYPES.map((s) => ({ value: s, label: s })),
    },
    { name: "location", label: "Location", required: true },
  ];

  const save = async (form) => {
    try {
      const payload = { ...form, team_id: teamId };
      if (dialog?.id) {
        await individualsApi.update(dialog.id, payload);
        setToast("Person updated");
      } else {
        await individualsApi.create(payload);
        setToast("Person added");
      }
      load();
    } catch (e) {
      throw apiError(e);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Remove ${p.name} from the organisation?`)) return;
    try {
      await individualsApi.remove(p.id);
      setToast("Person removed");
      load();
    } catch (e) {
      setError(apiError(e));
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" p={6}><CircularProgress /></Box>;
  }
  if (!team) return <Alert severity="error">{error || "Team not found"}</Alert>;

  const members = team.members || [];
  const byLevel = (lvl) => members.filter((m) => m.level === lvl);

  return (
    <Box sx={{ p: isMobile ? 1 : 0 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={onBack} size="small" sx={{ mb: 2 }}>
        Back to dashboard
      </Button>

      {error && <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>{error}</Alert>}

      <Stack direction="row" alignItems="flex-start" gap={1} flexWrap="wrap" mb={3}>
        <Box flex={1} minWidth={200}>
          <Typography variant="h6">{team.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {team.location} · {team.member_count} people
            {team.org_leader ? ` · reports to ${team.org_leader}` : ""}
          </Typography>
        </Box>
        {team.leader_offsite && (
          <Chip label={`Lead in ${team.leader_location}`} size="small" color="warning" />
        )}
        <Chip
          label={`${team.non_direct_pct ?? 0}% non-direct`}
          size="small"
          color={Number(team.non_direct_pct) > 20 ? "error" : "default"}
        />
      </Stack>

      <Tier label="Lead" people={byLevel("lead")} isLead onEdit={setDialog} onDelete={remove} />
      <Tier label="Members" people={byLevel("member")} onEdit={setDialog} onDelete={remove} />
      <Tier label="Juniors" people={byLevel("junior")} onEdit={setDialog} onDelete={remove} />

      {members.length === 0 && (
        <Typography variant="body2" color="text.secondary" py={2}>No members yet.</Typography>
      )}

      <Button size="small" startIcon={<AddIcon />} onClick={() => setDialog({})} sx={{ mb: 3 }}>
        Add person
      </Button>

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle2" mb={1}>Achievements</Typography>
      {(team.achievements || []).length === 0 && (
        <Typography variant="body2" color="text.secondary">No achievements recorded.</Typography>
      )}
      {(team.achievements || []).map((a) => (
        <Box key={a.id}>
          <Divider />
          <Stack direction="row" alignItems="center" gap={1.5} py={1.5}>
            <Box flex={1} minWidth={0}>
              <Typography variant="body2">{a.title}</Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(a.month).toLocaleDateString(undefined, {
                  year: "numeric", month: "long",
                })}
              </Typography>
            </Box>
            <Chip label={a.impact} size="small"
              color={a.impact === "high" ? "success" : "default"} variant="outlined" />
          </Stack>
        </Box>
      ))}

      <EntityDialog
        open={!!dialog}
        title={dialog?.id ? "Edit person" : "Add person"}
        fields={fields}
        initial={dialog?.id ? {
          name: dialog.name, email: dialog.email, role: dialog.role ?? "",
          level: dialog.level, staff_type: dialog.staff_type, location: dialog.location,
        } : {
          name: "", email: "", role: "", level: "member",
          staff_type: "direct", location: team.location,
        }}
        onClose={() => setDialog(null)}
        onSave={save}
      />

      <Snackbar open={!!toast} autoHideDuration={3000}
        onClose={() => setToast("")} message={toast} />
    </Box>
  );
}