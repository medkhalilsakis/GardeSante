import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Crosshair,
  Database,
  ExternalLink,
  Hospital,
  Info,
  LoaderCircle,
  LocateFixed,
  Mail,
  Map as MapIcon,
  MapPin,
  Navigation,
  Pencil,
  Phone,
  Power,
  PowerOff,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { establishmentsAPI } from '../../api';
import { useAuthStore } from '../../store';
import 'leaflet/dist/leaflet.css';
import './SuperAdminMapPage.css';

const TUNISIA_CENTER = [34, 9.3];
const TUNISIA_BOUNDS = L.latLngBounds([30, 7], [38, 12.5]);
const COORDINATE_LIMITS = { minLat: 30, maxLat: 38, minLng: 7, maxLng: 12.5 };

const GOVERNORATE_CENTERS = {
  ariana: [36.8665, 10.1647],
  beja: [36.7256, 9.1817],
  'ben arous': [36.7531, 10.2189],
  bizerte: [37.2744, 9.8739],
  gabes: [33.8815, 10.0982],
  gafsa: [34.4311, 8.7757],
  jendouba: [36.5011, 8.7802],
  kairouan: [35.6781, 10.0963],
  kasserine: [35.1676, 8.8365],
  kebili: [33.7044, 8.969],
  kef: [36.1742, 8.7049],
  'le kef': [36.1742, 8.7049],
  mahdia: [35.5047, 11.0622],
  manouba: [36.808, 10.0963],
  medenine: [33.3549, 10.5055],
  monastir: [35.7643, 10.8113],
  nabeul: [36.4561, 10.7376],
  sfax: [34.7406, 10.7603],
  'sidi bouzid': [35.0382, 9.4849],
  siliana: [36.0849, 9.3708],
  sousse: [35.8256, 10.637],
  tataouine: [32.9297, 10.4518],
  tozeur: [33.9197, 8.1335],
  tunis: [36.8065, 10.1815],
  zaghouan: [36.4029, 10.1429],
};

const TYPE_LABELS = {
  hospital: 'Hôpital',
  clinic: 'Clinique',
  institute: 'Institut',
};

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const isActive = (establishment) => (
  establishment?.is_active === true
  || establishment?.is_active === 'true'
  || establishment?.is_active === 1
);

function getCoordinateState(establishment) {
  const hasLatitude = establishment?.latitude !== null
    && establishment?.latitude !== undefined
    && establishment?.latitude !== '';
  const hasLongitude = establishment?.longitude !== null
    && establishment?.longitude !== undefined
    && establishment?.longitude !== '';

  if (!hasLatitude && !hasLongitude) return { kind: 'missing', position: null };

  const latitude = Number(establishment.latitude);
  const longitude = Number(establishment.longitude);
  const valid = hasLatitude
    && hasLongitude
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= COORDINATE_LIMITS.minLat
    && latitude <= COORDINATE_LIMITS.maxLat
    && longitude >= COORDINATE_LIMITS.minLng
    && longitude <= COORDINATE_LIMITS.maxLng;

  return valid
    ? { kind: 'located', position: [latitude, longitude] }
    : { kind: 'invalid', position: null };
}

function getIndicativePosition(establishment) {
  const coordinateState = getCoordinateState(establishment);
  if (coordinateState.position) return { position: coordinateState.position, approximate: false };

  const center = GOVERNORATE_CENTERS[normalizeText(establishment?.governorate)];
  if (!center) return { position: null, approximate: true };

  const seed = String(establishment?.id || establishment?.code || establishment?.name || '')
    .split('')
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const latitudeOffset = ((seed % 7) - 3) * 0.008;
  const longitudeOffset = (((seed * 3) % 7) - 3) * 0.008;

  return {
    position: [center[0] + latitudeOffset, center[1] + longitudeOffset],
    approximate: true,
  };
}

function markerHtml(kind, selected = false) {
  const symbol = kind === 'missing' ? '?' : '+';
  return `
    <div class="gsa-map-marker gsa-map-marker--${kind}${selected ? ' gsa-map-marker--selected' : ''}">
      <span class="gsa-map-marker__pin"><span class="gsa-map-marker__symbol">${symbol}</span></span>
      <span class="gsa-map-marker__shadow"></span>
    </div>
  `;
}

const MARKER_ICONS = Object.fromEntries(
  ['active', 'inactive', 'missing', 'draft'].flatMap((kind) => (
    [false, true].map((selected) => [
      `${kind}-${selected}`,
      L.divIcon({
        className: 'gsa-map-leaflet-icon',
        html: markerHtml(kind, selected),
        iconSize: [38, 46],
        iconAnchor: [19, 43],
        popupAnchor: [0, -39],
        tooltipAnchor: [18, -22],
      }),
    ])
  )),
);

function MapViewportController({ focusPosition, resetToken }) {
  const map = useMap();
  const previousResetToken = useRef(resetToken);

  useEffect(() => {
    if (!focusPosition) return;
    map.flyTo(focusPosition, Math.max(map.getZoom(), 11), {
      animate: true,
      duration: 0.65,
    });
  }, [focusPosition, map]);

  useEffect(() => {
    if (previousResetToken.current === resetToken) return;
    previousResetToken.current = resetToken;
    map.fitBounds(TUNISIA_BOUNDS, { padding: [22, 22], animate: true, duration: 0.6 });
  }, [map, resetToken]);

  return null;
}

function MapClickPicker({ active, onPick }) {
  useMapEvents({
    click(event) {
      if (!active) return;
      onPick(event.latlng);
    },
  });
  return null;
}

function KpiCard({ icon: Icon, tone, label, value, note }) {
  return (
    <div className={`gsa-map-kpi gsa-map-kpi--${tone}`}>
      <div className="gsa-map-kpi__icon"><Icon size={20} aria-hidden="true" /></div>
      <div className="gsa-map-kpi__copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

function StatusBadge({ establishment }) {
  const active = isActive(establishment);
  return (
    <span className={`gsa-map-status gsa-map-status--${active ? 'active' : 'inactive'}`}>
      {active ? <Power size={12} aria-hidden="true" /> : <PowerOff size={12} aria-hidden="true" />}
      {active ? 'Actif' : 'Inactif'}
    </span>
  );
}

function PositionBadge({ establishment, compact = false }) {
  const state = getCoordinateState(establishment);
  const configured = state.kind === 'located';
  return (
    <span className={`gsa-map-position-badge gsa-map-position-badge--${configured ? 'located' : 'missing'}`}>
      {configured
        ? <CheckCircle2 size={12} aria-hidden="true" />
        : <AlertTriangle size={12} aria-hidden="true" />}
      {configured ? (compact ? 'GPS' : 'Coordonnées vérifiées') : (compact ? 'À placer' : 'Coordonnées à corriger')}
    </span>
  );
}

function EmptyState({ hasFilters, onReset }) {
  return (
    <div className="gsa-map-empty">
      <MapPin size={28} aria-hidden="true" />
      <strong>Aucun établissement trouvé</strong>
      <p>{hasFilters ? 'Ajustez les critères de recherche.' : 'Aucun établissement n’est encore enregistré.'}</p>
      {hasFilters && (
        <button type="button" onClick={onReset}>
          <RotateCcw size={14} aria-hidden="true" /> Réinitialiser
        </button>
      )}
    </div>
  );
}

export default function SuperAdminMapPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [search, setSearch] = useState('');
  const [governorateFilter, setGovernorateFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [positionFilter, setPositionFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [resetToken, setResetToken] = useState(0);
  const [editorEstablishment, setEditorEstablishment] = useState(null);
  const [coordinateForm, setCoordinateForm] = useState({ latitude: '', longitude: '' });
  const [coordinateError, setCoordinateError] = useState('');
  const [pickingCoordinates, setPickingCoordinates] = useState(false);

  const {
    data: establishments = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['establishments'],
    queryFn: () => establishmentsAPI.getAll().then((response) => response?.data?.data || []),
  });

  const selectedEstablishment = useMemo(
    () => establishments.find((establishment) => establishment.id === selectedId) || null,
    [establishments, selectedId],
  );

  const governorates = useMemo(() => (
    [...new Set(establishments.map((establishment) => establishment.governorate).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'fr'))
  ), [establishments]);

  const filteredEstablishments = useMemo(() => {
    const normalizedSearch = normalizeText(search);

    return establishments.filter((establishment) => {
      const coordinateState = getCoordinateState(establishment);
      const searchable = normalizeText([
        establishment.name,
        establishment.code,
        establishment.type,
        establishment.governorate,
        establishment.delegation,
        establishment.city,
        establishment.address,
      ].filter(Boolean).join(' '));

      if (normalizedSearch && !searchable.includes(normalizedSearch)) return false;
      if (governorateFilter !== 'all' && establishment.governorate !== governorateFilter) return false;
      if (statusFilter === 'active' && !isActive(establishment)) return false;
      if (statusFilter === 'inactive' && isActive(establishment)) return false;
      if (positionFilter === 'located' && coordinateState.kind !== 'located') return false;
      if (positionFilter === 'needs-position' && coordinateState.kind === 'located') return false;
      return true;
    });
  }, [establishments, governorateFilter, positionFilter, search, statusFilter]);

  const totals = useMemo(() => {
    const located = establishments.filter((establishment) => getCoordinateState(establishment).kind === 'located').length;
    const active = establishments.filter(isActive).length;
    const personnel = establishments.reduce(
      (sum, establishment) => sum + (Number.parseInt(establishment.user_count, 10) || 0),
      0,
    );
    return {
      total: establishments.length,
      located,
      active,
      needsPosition: establishments.length - located,
      personnel,
    };
  }, [establishments]);

  const selectedMapPosition = useMemo(() => {
    if (!selectedEstablishment) return null;
    return getIndicativePosition(selectedEstablishment).position;
  }, [selectedEstablishment]);

  const mappedFilteredCount = useMemo(
    () => filteredEstablishments.filter((establishment) => getIndicativePosition(establishment).position).length,
    [filteredEstablishments],
  );

  const draftPosition = useMemo(() => {
    const latitude = Number(coordinateForm.latitude);
    const longitude = Number(coordinateForm.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < 30 || latitude > 38 || longitude < 7 || longitude > 12.5) return null;
    return [latitude, longitude];
  }, [coordinateForm]);

  const hasFilters = Boolean(
    search
    || governorateFilter !== 'all'
    || statusFilter !== 'all'
    || positionFilter !== 'all',
  );

  const resetFilters = () => {
    setSearch('');
    setGovernorateFilter('all');
    setStatusFilter('all');
    setPositionFilter('all');
  };

  const selectEstablishment = (establishment) => {
    setSelectedId(establishment.id);
  };

  const openCoordinateEditor = (establishment) => {
    setSelectedId(establishment.id);
    setEditorEstablishment(establishment);
    setCoordinateForm({
      latitude: establishment.latitude ?? '',
      longitude: establishment.longitude ?? '',
    });
    setCoordinateError('');
    setPickingCoordinates(false);
  };

  const closeCoordinateEditor = () => {
    setEditorEstablishment(null);
    setCoordinateError('');
    setPickingCoordinates(false);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && editorEstablishment) closeCoordinateEditor();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editorEstablishment]);

  const updateCoordinates = useMutation({
    mutationFn: ({ id, latitude, longitude }) => (
      establishmentsAPI.update(id, { latitude, longitude })
    ),
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['establishments'] });
      setSelectedId(variables.id);
      closeCoordinateEditor();
      toast.success('Coordonnées cartographiques mises à jour');
    },
    onError: (error) => {
      toast.error(error?.response?.data?.message || 'Impossible de mettre à jour les coordonnées');
    },
  });

  const setPickedCoordinates = (latlng) => {
    setCoordinateForm({
      latitude: latlng.lat.toFixed(6),
      longitude: latlng.lng.toFixed(6),
    });
    setCoordinateError('');
    setPickingCoordinates(false);
  };

  const submitCoordinates = (event) => {
    event.preventDefault();
    const latitude = Number(coordinateForm.latitude);
    const longitude = Number(coordinateForm.longitude);

    if (coordinateForm.latitude === '' || coordinateForm.longitude === '') {
      setCoordinateError('La latitude et la longitude sont obligatoires.');
      return;
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setCoordinateError('Saisissez des coordonnées numériques valides.');
      return;
    }
    if (latitude < 30 || latitude > 38 || longitude < 7 || longitude > 12.5) {
      setCoordinateError('Les coordonnées doivent se situer en Tunisie : latitude 30–38, longitude 7–12,5.');
      return;
    }

    setCoordinateError('');
    updateCoordinates.mutate({
      id: editorEstablishment.id,
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
    });
  };

  return (
    <div className="gsa-map-page">
      <header className="gsa-map-header">
        <div className="gsa-map-header__identity">
          <div className="gsa-map-header__icon"><MapIcon size={24} aria-hidden="true" /></div>
          <div>
            <div className="gsa-map-header__eyebrow">
              <span className="gsa-map-header__live-dot" aria-hidden="true" /> Réseau national en consultation
            </div>
            <h1>Carte sanitaire de la Tunisie</h1>
            <p>
              Localisation et accès rapide aux établissements enregistrés
              {user?.firstName ? ` · session de ${user.firstName}` : ''}
            </p>
          </div>
        </div>
        <div className="gsa-map-header__status" aria-live="polite">
          {isFetching && !isLoading ? <LoaderCircle className="gsa-map-spin" size={15} aria-hidden="true" /> : <Database size={15} aria-hidden="true" />}
          {isFetching && !isLoading ? 'Synchronisation…' : 'Données à jour'}
        </div>
      </header>

      <section className="gsa-map-kpis" aria-label="Indicateurs du réseau hospitalier">
        <KpiCard icon={Hospital} tone="seal" label="Établissements" value={totals.total} note="dans le réseau national" />
        <KpiCard icon={LocateFixed} tone="duty" label="Positionnés" value={totals.located} note={`${totals.total ? Math.round((totals.located / totals.total) * 100) : 0}% avec coordonnées GPS`} />
        <KpiCard icon={Power} tone="duty" label="En activité" value={totals.active} note={`${totals.total - totals.active} établissement(s) inactif(s)`} />
        <KpiCard icon={Users} tone="seal" label="Personnel suivi" value={totals.personnel.toLocaleString('fr-FR')} note="tous établissements confondus" />
      </section>

      {totals.needsPosition > 0 && !isLoading && (
        <section className="gsa-map-coordinate-alert" aria-label="Coordonnées à compléter">
          <div className="gsa-map-coordinate-alert__icon"><AlertTriangle size={19} aria-hidden="true" /></div>
          <div>
            <strong>{totals.needsPosition} établissement{totals.needsPosition > 1 ? 's' : ''} à positionner précisément</strong>
            <p>Les repères sans position vérifiée sont indicatifs. Ajoutez leurs coordonnées GPS pour fiabiliser la carte.</p>
          </div>
          <button type="button" onClick={() => setPositionFilter('needs-position')}>
            Voir la liste <ChevronRight size={15} aria-hidden="true" />
          </button>
        </section>
      )}

      <section className="gsa-map-toolbar" aria-label="Filtres cartographiques">
        <label className="gsa-map-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Rechercher un établissement</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nom, code, ville ou adresse…"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} title="Effacer la recherche" aria-label="Effacer la recherche">
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </label>

        <div className="gsa-map-filter-group">
          <SlidersHorizontal size={16} aria-hidden="true" />
          <label>
            <span className="sr-only">Gouvernorat</span>
            <select value={governorateFilter} onChange={(event) => setGovernorateFilter(event.target.value)}>
              <option value="all">Tous les gouvernorats</option>
              {governorates.map((governorate) => <option key={governorate} value={governorate}>{governorate}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Statut</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Tous les statuts</option>
              <option value="active">Actifs</option>
              <option value="inactive">Inactifs</option>
            </select>
          </label>
          <label>
            <span className="sr-only">État du positionnement</span>
            <select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)}>
              <option value="all">Toutes les positions</option>
              <option value="located">Coordonnées vérifiées</option>
              <option value="needs-position">À positionner</option>
            </select>
          </label>
        </div>

        {hasFilters && (
          <button className="gsa-map-reset" type="button" onClick={resetFilters} title="Réinitialiser les filtres">
            <RotateCcw size={15} aria-hidden="true" />
            Réinitialiser
          </button>
        )}
      </section>

      {isError ? (
        <section className="gsa-map-error" role="alert">
          <AlertTriangle size={34} aria-hidden="true" />
          <div>
            <strong>La carte ne peut pas charger les établissements.</strong>
            <p>Vérifiez la connexion au serveur puis relancez la synchronisation.</p>
          </div>
          <button type="button" onClick={() => refetch()}>Réessayer</button>
        </section>
      ) : (
        <section className="gsa-map-workspace">
          <aside className="gsa-map-directory" aria-label="Répertoire des établissements">
            <div className="gsa-map-directory__header">
              <div>
                <span>Répertoire national</span>
                <strong>{filteredEstablishments.length} résultat{filteredEstablishments.length > 1 ? 's' : ''}</strong>
              </div>
              <span className="gsa-map-directory__count">{totals.total}</span>
            </div>

            {selectedEstablishment && (
              <article className="gsa-map-selection" aria-label={`Établissement sélectionné : ${selectedEstablishment.name}`}>
                <div className="gsa-map-selection__top">
                  <div className="gsa-map-selection__logo"><Hospital size={21} aria-hidden="true" /></div>
                  <div className="gsa-map-selection__title">
                    <span>{TYPE_LABELS[selectedEstablishment.type] || selectedEstablishment.type || 'Établissement'}</span>
                    <h2>{selectedEstablishment.name}</h2>
                    <small>{selectedEstablishment.code || 'Code non renseigné'}</small>
                  </div>
                  <button type="button" className="gsa-map-icon-button" onClick={() => setSelectedId(null)} title="Fermer la fiche" aria-label="Fermer la fiche">
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>

                <div className="gsa-map-selection__badges">
                  <StatusBadge establishment={selectedEstablishment} />
                  <PositionBadge establishment={selectedEstablishment} />
                </div>

                <div className="gsa-map-selection__address">
                  <MapPin size={16} aria-hidden="true" />
                  <p>{[
                    selectedEstablishment.address,
                    selectedEstablishment.delegation,
                    selectedEstablishment.city,
                    selectedEstablishment.governorate,
                  ].filter(Boolean).join(', ') || 'Adresse non renseignée'}</p>
                </div>

                <dl className="gsa-map-selection__facts">
                  <div>
                    <dt><Users size={14} aria-hidden="true" /> Personnel</dt>
                    <dd>{Number.parseInt(selectedEstablishment.user_count, 10) || 0}</dd>
                  </div>
                  <div>
                    <dt><Building2 size={14} aria-hidden="true" /> Services</dt>
                    <dd>{Number.parseInt(selectedEstablishment.dept_count, 10) || 0}</dd>
                  </div>
                </dl>

                {(selectedEstablishment.director_first_name || selectedEstablishment.director_last_name) && (
                  <div className="gsa-map-selection__contact">
                    <UserRound size={15} aria-hidden="true" />
                    <span>Direction</span>
                    <strong>{[selectedEstablishment.director_first_name, selectedEstablishment.director_last_name].filter(Boolean).join(' ')}</strong>
                  </div>
                )}

                <div className="gsa-map-selection__links">
                  {selectedEstablishment.phone && <a href={`tel:${selectedEstablishment.phone}`} title="Appeler"><Phone size={15} aria-hidden="true" /></a>}
                  {selectedEstablishment.email && <a href={`mailto:${selectedEstablishment.email}`} title="Envoyer un e-mail"><Mail size={15} aria-hidden="true" /></a>}
                  <span className="gsa-map-selection__coordinates">
                    <Crosshair size={14} aria-hidden="true" />
                    {getCoordinateState(selectedEstablishment).kind === 'located'
                      ? `${Number(selectedEstablishment.latitude).toFixed(4)}, ${Number(selectedEstablishment.longitude).toFixed(4)}`
                      : 'Position indicative'}
                  </span>
                </div>

                <div className="gsa-map-selection__actions">
                  <button type="button" className="gsa-map-button gsa-map-button--secondary" onClick={() => openCoordinateEditor(selectedEstablishment)}>
                    <Pencil size={15} aria-hidden="true" /> Corriger la position
                  </button>
                  <button type="button" className="gsa-map-button gsa-map-button--primary" onClick={() => navigate(`/admin?establishment=${encodeURIComponent(selectedEstablishment.id)}`)}>
                    Gérer <ExternalLink size={15} aria-hidden="true" />
                  </button>
                </div>
              </article>
            )}

            <div className="gsa-map-directory__list">
              {isLoading ? (
                Array.from({ length: 6 }, (_, index) => (
                  <div className="gsa-map-list-skeleton" key={index} aria-hidden="true">
                    <span /><div><i /><i /></div>
                  </div>
                ))
              ) : filteredEstablishments.length === 0 ? (
                <EmptyState hasFilters={hasFilters} onReset={resetFilters} />
              ) : filteredEstablishments.map((establishment) => {
                const selected = establishment.id === selectedId;
                const coordinateState = getCoordinateState(establishment);
                return (
                  <article className={`gsa-map-list-item${selected ? ' gsa-map-list-item--selected' : ''}`} key={establishment.id}>
                    <button type="button" className="gsa-map-list-item__main" onClick={() => selectEstablishment(establishment)}>
                      <span className={`gsa-map-list-item__glyph gsa-map-list-item__glyph--${isActive(establishment) ? 'active' : 'inactive'}`}>
                        <Hospital size={18} aria-hidden="true" />
                      </span>
                      <span className="gsa-map-list-item__content">
                        <span className="gsa-map-list-item__name">{establishment.name}</span>
                        <span className="gsa-map-list-item__meta">
                          {establishment.code || 'Sans code'} · {establishment.governorate || establishment.city || 'Localité inconnue'}
                        </span>
                        <span className="gsa-map-list-item__badges">
                          <StatusBadge establishment={establishment} />
                          <PositionBadge establishment={establishment} compact />
                        </span>
                      </span>
                      <ChevronRight size={17} aria-hidden="true" />
                    </button>
                    {coordinateState.kind !== 'located' && (
                      <button
                        type="button"
                        className="gsa-map-list-item__locate"
                        onClick={() => openCoordinateEditor(establishment)}
                        title="Ajouter les coordonnées"
                        aria-label={`Ajouter les coordonnées de ${establishment.name}`}
                      >
                        <LocateFixed size={15} aria-hidden="true" />
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </aside>

          <div className={`gsa-map-canvas${pickingCoordinates ? ' gsa-map-canvas--picking' : ''}`}>
            <div className="gsa-map-canvas__topbar">
              <div>
                <Navigation size={16} aria-hidden="true" />
                <span><strong>{mappedFilteredCount}</strong> affiché{mappedFilteredCount > 1 ? 's' : ''} sur la carte</span>
              </div>
              <button type="button" onClick={() => setResetToken((value) => value + 1)} title="Recentrer sur la Tunisie">
                <Crosshair size={16} aria-hidden="true" /> Recentrer
              </button>
            </div>

            {pickingCoordinates && (
              <div className="gsa-map-pick-instruction" role="status">
                <Crosshair size={18} aria-hidden="true" />
                <span>Cliquez sur l’emplacement exact de l’établissement.</span>
                <button type="button" onClick={() => setPickingCoordinates(false)}>Annuler</button>
              </div>
            )}

            <MapContainer
              center={TUNISIA_CENTER}
              zoom={6}
              minZoom={6}
              maxZoom={18}
              maxBounds={TUNISIA_BOUNDS}
              maxBoundsViscosity={0.92}
              zoomControl={false}
              className="gsa-map-leaflet"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <ZoomControl position="bottomright" />
              <MapViewportController focusPosition={selectedMapPosition} resetToken={resetToken} />
              <MapClickPicker active={pickingCoordinates} onPick={setPickedCoordinates} />

              {filteredEstablishments.map((establishment) => {
                const coordinateState = getCoordinateState(establishment);
                const displayPosition = getIndicativePosition(establishment);
                if (!displayPosition.position) return null;

                const markerKind = displayPosition.approximate
                  ? 'missing'
                  : (isActive(establishment) ? 'active' : 'inactive');
                const selected = establishment.id === selectedId;

                return (
                  <Marker
                    key={establishment.id}
                    position={displayPosition.position}
                    icon={MARKER_ICONS[`${markerKind}-${selected}`]}
                    zIndexOffset={selected ? 1000 : (displayPosition.approximate ? 100 : 400)}
                    eventHandlers={{ click: () => selectEstablishment(establishment) }}
                  >
                    <Tooltip direction="right" opacity={1} sticky>
                      <div className="gsa-map-tooltip">
                        <strong>{establishment.name}</strong>
                        <span>{establishment.governorate || establishment.city || 'Localité non renseignée'}</span>
                        {displayPosition.approximate && <em>Position indicative · GPS à compléter</em>}
                      </div>
                    </Tooltip>
                    <Popup minWidth={245} maxWidth={290}>
                      <div className="gsa-map-popup">
                        <div className="gsa-map-popup__heading">
                          <span><Hospital size={17} aria-hidden="true" /></span>
                          <div><strong>{establishment.name}</strong><small>{establishment.code || TYPE_LABELS[establishment.type] || 'Établissement'}</small></div>
                        </div>
                        <p><MapPin size={14} aria-hidden="true" /> {[establishment.city, establishment.governorate].filter(Boolean).join(', ') || 'Adresse à compléter'}</p>
                        <div className="gsa-map-popup__badges">
                          <StatusBadge establishment={establishment} />
                          <PositionBadge establishment={establishment} compact />
                        </div>
                        <div className="gsa-map-popup__actions">
                          <button type="button" onClick={() => openCoordinateEditor(establishment)}><Pencil size={14} aria-hidden="true" /> Position</button>
                          <button type="button" onClick={() => navigate(`/admin?establishment=${encodeURIComponent(establishment.id)}`)}>Gérer <ExternalLink size={14} aria-hidden="true" /></button>
                        </div>
                        {coordinateState.kind !== 'located' && (
                          <small className="gsa-map-popup__notice"><Info size={12} aria-hidden="true" /> Ce repère utilise le centre approximatif du gouvernorat.</small>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {editorEstablishment && draftPosition && (
                <Marker
                  position={draftPosition}
                  icon={MARKER_ICONS['draft-true']}
                  draggable
                  zIndexOffset={1600}
                  eventHandlers={{
                    dragend: (event) => setPickedCoordinates(event.target.getLatLng()),
                  }}
                >
                  <Tooltip permanent direction="top" opacity={1}>Nouvelle position</Tooltip>
                </Marker>
              )}
            </MapContainer>

            <div className="gsa-map-legend" aria-label="Légende de la carte">
              <span><i className="gsa-map-legend__dot gsa-map-legend__dot--active" /> Actif</span>
              <span><i className="gsa-map-legend__dot gsa-map-legend__dot--inactive" /> Inactif</span>
              <span><i className="gsa-map-legend__dot gsa-map-legend__dot--missing" /> Position indicative</span>
            </div>
          </div>
        </section>
      )}

      {editorEstablishment && (
        <>
          <div className="gsa-map-coordinate-scrim" aria-hidden="true" />
          <aside className="gsa-map-coordinate-drawer" role="dialog" aria-labelledby="coordinate-editor-title">
            <div className="gsa-map-coordinate-drawer__header">
              <div className="gsa-map-coordinate-drawer__header-icon"><LocateFixed size={21} aria-hidden="true" /></div>
              <div>
                <span>Référencement cartographique</span>
                <h2 id="coordinate-editor-title">Corriger la position</h2>
              </div>
              <button type="button" onClick={closeCoordinateEditor} title="Fermer" aria-label="Fermer l’éditeur de coordonnées">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="gsa-map-coordinate-drawer__establishment">
              <Hospital size={19} aria-hidden="true" />
              <div><strong>{editorEstablishment.name}</strong><span>{editorEstablishment.code || editorEstablishment.governorate || 'Établissement'}</span></div>
              <PositionBadge establishment={editorEstablishment} compact />
            </div>

            <form onSubmit={submitCoordinates} className="gsa-map-coordinate-form">
              <div className="gsa-map-coordinate-form__help">
                <Info size={17} aria-hidden="true" />
                <p>Renseignez les coordonnées exactes ou sélectionnez directement le bâtiment sur la carte. Le marqueur bleu peut aussi être déplacé.</p>
              </div>

              <div className="gsa-map-coordinate-form__fields">
                <label>
                  <span>Latitude</span>
                  <div><Navigation size={15} aria-hidden="true" /><input type="number" min="30" max="38" step="0.000001" value={coordinateForm.latitude} onChange={(event) => { setCoordinateForm((form) => ({ ...form, latitude: event.target.value })); setCoordinateError(''); }} placeholder="36.806389" autoFocus /></div>
                  <small>Entre 30 et 38</small>
                </label>
                <label>
                  <span>Longitude</span>
                  <div><Navigation size={15} aria-hidden="true" /><input type="number" min="7" max="12.5" step="0.000001" value={coordinateForm.longitude} onChange={(event) => { setCoordinateForm((form) => ({ ...form, longitude: event.target.value })); setCoordinateError(''); }} placeholder="10.181667" /></div>
                  <small>Entre 7 et 12,5</small>
                </label>
              </div>

              <button
                type="button"
                className={`gsa-map-coordinate-form__picker${pickingCoordinates ? ' is-active' : ''}`}
                onClick={() => setPickingCoordinates((value) => !value)}
              >
                <Crosshair size={18} aria-hidden="true" />
                <span><strong>{pickingCoordinates ? 'Sélection en cours' : 'Choisir sur la carte'}</strong><small>Cliquez ensuite sur l’emplacement exact</small></span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>

              {draftPosition && (
                <div className="gsa-map-coordinate-form__preview">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>Position prête : <strong>{Number(draftPosition[0]).toFixed(6)}, {Number(draftPosition[1]).toFixed(6)}</strong></span>
                </div>
              )}

              {coordinateError && (
                <div className="gsa-map-coordinate-form__error" role="alert">
                  <AlertTriangle size={15} aria-hidden="true" /> {coordinateError}
                </div>
              )}

              <div className="gsa-map-coordinate-form__footer">
                <button type="button" onClick={closeCoordinateEditor}>Annuler</button>
                <button type="submit" disabled={updateCoordinates.isPending}>
                  {updateCoordinates.isPending ? <LoaderCircle className="gsa-map-spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                  {updateCoordinates.isPending ? 'Enregistrement…' : 'Enregistrer la position'}
                </button>
              </div>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}
