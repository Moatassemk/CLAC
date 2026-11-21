import { useState } from 'react';
import { m, AnimatePresence } from 'framer-motion';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import Tabs from '@mui/material/Tabs';
import Stack from '@mui/material/Stack';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';

import { useRouter, useSearchParams } from 'src/routes/hooks';

import { useApi, cleanParams } from 'src/hooks/use-api';

import { fQty, fDate, fMoney, initials, fFromNow, GOVERNORATES, REQUEST_STATUS } from 'src/utils/clac';

import { endpoints } from 'src/lib/axios';
import { useSocketEvent } from 'src/lib/socket';
import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';

import { openConversation } from '../components/contact';
import { printDocument } from '../components/print-button';
import { Empty, PageHeader, StatusLabel, ListSkeleton, PagePagination, useReferenceData } from '../components/ui';

// ----------------------------------------------------------------------

function RequestCard({ r, onOpen, fresh, delay }) {
  return (
    <Card
      component={m.div}
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      onClick={() => onOpen(r.id)}
      sx={{
        p: 2.5,
        cursor: 'pointer',
        transition: 'box-shadow .2s, transform .2s',
        '&:hover': { transform: 'translateY(-3px)', boxShadow: (theme) => theme.customShadows.z16 },
        ...(fresh && { outline: (theme) => `2px solid ${theme.vars.palette.primary.main}` }),
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
        <Avatar src={r.buyer.avatar_url ?? undefined} sx={{ bgcolor: 'info.lighter', color: 'info.dark' }}>
          {initials(r.buyer.company_name || r.buyer.name)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            {r.buyer.company_name || r.buyer.name}
            {r.buyer.is_verified && <Iconify icon="solar:verified-check-bold" width={16} sx={{ color: 'info.main', ml: 0.5, verticalAlign: 'middle' }} />}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {fFromNow(r.created_at)}
          </Typography>
        </Box>
        {fresh && <Label color="primary" variant="filled">Nouveau</Label>}
        {r.target_user_id && <Label color="secondary">Pour vous</Label>}
      </Stack>

      <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
        {r.title}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 40 }}>
        {r.description || 'Pas de description.'}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, p: 1.5, borderRadius: 1.5, bgcolor: 'background.neutral' }}>
        {[
          ['Quantité', fQty(r.quantity, r.unit)],
          ['Prix max', r.max_price_per_unit != null ? fMoney(r.max_price_per_unit) : '—'],
          ['Pour le', fDate(r.needed_by)],
        ].map(([label, value]) => (
          <Box key={label}>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              {label}
            </Typography>
            <Typography variant="subtitle2" noWrap>
              {value}
            </Typography>
          </Box>
        ))}
      </Box>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2 }}>
        <Label color="primary">{r.category_name ?? '—'}</Label>
        {r.quantity_discount && <Label color="success">Remise quantité</Label>}
        <Label>
          <Iconify icon="solar:map-point-bold" width={14} sx={{ mr: 0.5 }} />
          {r.gouvernorat ?? '—'}
        </Label>
      </Stack>
    </Card>
  );
}

// ----------------------------------------------------------------------

function RequestDrawer({ id, onClose }) {
  const router = useRouter();
  const { data: r } = useApi(id ? endpoints.requests.details(id) : null);

  const contact = async () => router.push(await openConversation(r.buyer_id, { body: `Bonjour, au sujet de votre demande « ${r.title} »`, context_type: 'request', context_id: r.id }));

  return (
    <Drawer anchor="right" open={!!id} onClose={onClose} PaperProps={{ sx: { width: 1, maxWidth: 520 } }}>
      {r && (
        <>
          <Stack direction="row" alignItems="center" sx={{ p: 2.5, pb: 2 }}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              Demande d’achat
            </Typography>
            <IconButton onClick={() => printDocument('requests', r.id)}>
              <Iconify icon="solar:printer-minimalistic-bold" />
            </IconButton>
            <IconButton onClick={onClose}>
              <Iconify icon="mingcute:close-line" />
            </IconButton>
          </Stack>
          <Divider />
          <Scrollbar sx={{ p: 2.5 }}>
            <Stack spacing={2.5}>
              <Stack direction="row" spacing={1}>
                <StatusLabel map={REQUEST_STATUS} value={r.status} />
                {r.category_name && <Label color="primary">{r.category_name}</Label>}
              </Stack>
              <Typography variant="h5">{r.title}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'pre-line' }}>
                {r.description || 'Pas de description.'}
              </Typography>

              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, p: 2, borderRadius: 1.5, bgcolor: 'background.neutral' }}>
                {[
                  ['solar:box-bold-duotone', 'Quantité', fQty(r.quantity, r.unit)],
                  ['solar:wallet-money-bold-duotone', 'Prix max', r.max_price_per_unit != null ? `${fMoney(r.max_price_per_unit)} / ${r.unit}` : 'Non précisé'],
                  ['solar:calendar-bold-duotone', 'Besoin pour le', fDate(r.needed_by)],
                  ['solar:map-point-bold-duotone', 'Lieu', r.gouvernorat ?? '—'],
                ].map(([icon, label, value]) => (
                  <Stack key={label} direction="row" spacing={1} alignItems="center">
                    <Iconify icon={icon} sx={{ color: 'primary.main' }} />
                    <Box>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {label}
                      </Typography>
                      <Typography variant="subtitle2">{value}</Typography>
                    </Box>
                  </Stack>
                ))}
              </Box>

              {r.quantity_discount && (
                <Label color="success" startIcon={<Iconify icon="solar:tag-price-bold" width={14} />}>
                  Remise quantité du vendeur appliquée
                </Label>
              )}

              <Card variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ bgcolor: 'info.lighter', color: 'info.dark' }}>{initials(r.buyer.company_name || r.buyer.name)}</Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle2">{r.buyer.company_name || r.buyer.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    Acheteur · {r.buyer.gouvernorat}
                  </Typography>
                </Box>
                <Button variant="soft" color="primary" startIcon={<Iconify icon="solar:chat-round-dots-bold" />} onClick={contact}>
                  Contacter
                </Button>
              </Card>
            </Stack>
          </Scrollbar>
        </>
      )}
    </Drawer>
  );
}

// ----------------------------------------------------------------------

export function RequestsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openId = searchParams.get('r');
  const { categories } = useReferenceData();
  const [filters, setFilters] = useState({ tab: 'open', q: '', category_id: '', gouvernorat: '', page: 1 });
  const [fresh, setFresh] = useState([]);

  const params = cleanParams({
    q: filters.q,
    category_id: filters.category_id,
    gouvernorat: filters.gouvernorat,
    page: filters.page,
    limit: 12,
    ...(filters.tab === 'all' ? { include_closed: true } : { status: filters.tab }),
  });
  const { data, meta, loading, setData } = useApi(endpoints.requests.received, params);

  useSocketEvent('request:new', (request) => {
    setFresh((ids) => [request.id, ...ids]);
    if (filters.tab === 'open' && filters.page === 1) setData((list) => [request, ...(list ?? [])]);
  });

  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));
  const open = (id) => router.push(`?r=${id}`);
  const close = () => router.push('?');

  return (
    <DashboardContent maxWidth="xl">
      <PageHeader
        icon="solar:inbox-in-bold-duotone"
        title="Demandes reçues"
        subtitle="Les besoins des acheteurs dans vos catégories — contactez-les en direct."
      />

      <Card sx={{ mb: 3 }}>
        <Tabs value={filters.tab} onChange={(_, tab) => set({ tab })} sx={{ px: 2.5, boxShadow: (theme) => `inset 0 -2px 0 0 ${theme.vars.palette.divider}` }}>
          <Tab value="open" label="Ouvertes" />
          <Tab value="in_progress" label="En cours" />
          <Tab value="all" label="Toutes" />
        </Tabs>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ p: 2.5 }}>
          <TextField
            fullWidth
            placeholder="Rechercher dans les demandes…"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><Iconify icon="eva:search-fill" /></InputAdornment> } }}
          />
          <TextField select label="Catégorie" value={filters.category_id} onChange={(e) => set({ category_id: e.target.value })} sx={{ minWidth: 220 }}>
            <MenuItem value="">Toutes</MenuItem>
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Gouvernorat" value={filters.gouvernorat} onChange={(e) => set({ gouvernorat: e.target.value })} sx={{ minWidth: 200 }}>
            <MenuItem value="">Tous</MenuItem>
            {GOVERNORATES.map((g) => (
              <MenuItem key={g} value={g}>
                {g}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Card>

      {loading && !data ? (
        <ListSkeleton height={280} />
      ) : data?.length ? (
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: 'repeat(3, 1fr)' } }}>
          <AnimatePresence>
            {data.map((r, i) => (
              <RequestCard key={r.id} r={r} delay={i * 0.03} fresh={fresh.includes(r.id)} onOpen={open} />
            ))}
          </AnimatePresence>
        </Box>
      ) : (
        <Empty
          title="Aucune demande"
          description="Ajoutez des catégories suivies dans votre profil ou publiez des produits pour recevoir plus de demandes."
          icon="solar:inbox-bold-duotone"
        />
      )}

      <PagePagination meta={meta} onChange={(page) => setFilters((f) => ({ ...f, page }))} />

      <RequestDrawer id={openId} onClose={close} />
    </DashboardContent>
  );
}
