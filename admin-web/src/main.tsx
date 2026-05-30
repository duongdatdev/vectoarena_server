import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BadgeCheck,
  Coins,
  Database,
  Gauge,
  LogOut,
  Search,
  Shield,
  Swords,
  UserCog,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import "./styles.css";

type View = "overview" | "users" | "matches" | "transactions" | "anticheat" | "nft";

type SessionUser = {
  id: string;
  username: string;
  role: string;
};

type Session = {
  token: string;
  user: SessionUser;
};

type ApiState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

const navItems: Array<{ id: View; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "users", label: "Users", icon: Users },
  { id: "matches", label: "Matches", icon: Swords },
  { id: "transactions", label: "Transactions", icon: Coins },
  { id: "anticheat", label: "Anti-cheat", icon: Shield },
  { id: "nft", label: "NFT / Skins", icon: WalletCards },
];

const storageKey = "vectoarena-admin-session";

function readStoredSession(): Session | null {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatNumber(value: number | undefined | null) {
  return new Intl.NumberFormat("en").format(value ?? 0);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body as T;
}

function useApi<T>(session: Session | null, path: string, deps: React.DependencyList = []): ApiState<T> & { reload: () => void } {
  const [state, setState] = useState<ApiState<T>>({ data: null, loading: true, error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!session) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    fetch(path, { headers: { Authorization: `Bearer ${session.token}` } })
      .then(parseResponse<T>)
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((error: Error) => {
        if (active) setState({ data: null, loading: false, error: error.message });
      });

    return () => {
      active = false;
    };
  }, [session?.token, path, version, ...deps]);

  return { ...state, reload: () => setVersion((value) => value + 1) };
}

function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const session = await parseResponse<Session>(response);
      if (session.user.role !== "ADMIN") {
        throw new Error("This account does not have admin access.");
      }
      window.localStorage.setItem(storageKey, JSON.stringify(session));
      onLogin(session);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-mark">
          <Shield size={28} />
        </div>
        <h1 id="login-title">VectoArena Admin</h1>
        <p>Operations console for players, economy, matches, NFT skins, and anti-cheat review.</p>
        <form onSubmit={submit} className="login-form">
          <label htmlFor="username">Username</label>
          <input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
          {error ? <div className="error" aria-live="polite">{error}</div> : null}
          <button className="primary-button" disabled={loading || !username || !password}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

function StatusBlock<T>({ state, children }: { state: ApiState<T>; children: (data: T) => React.ReactNode }) {
  if (state.loading) return <div className="status-box" aria-live="polite">Loading data...</div>;
  if (state.error) return <div className="status-box error" aria-live="polite">{state.error}</div>;
  if (!state.data) return <div className="status-box">No data</div>;
  return <>{children(state.data)}</>;
}

function MetricCard({ label, value, icon: Icon, tone = "blue" }: { label: string; value: React.ReactNode; icon: LucideIcon; tone?: string }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <Icon size={22} />
    </article>
  );
}

function Overview({ session }: { session: Session }) {
  const state = useApi<any>(session, "/admin/overview");

  return (
    <StatusBlock state={state}>
      {(data) => (
        <div className="stack">
          <section className="metrics-grid">
            <MetricCard label="Users" value={formatNumber(data.metrics.totalUsers)} icon={Users} />
            <MetricCard label="Admins" value={formatNumber(data.metrics.adminUsers)} icon={UserCog} tone="amber" />
            <MetricCard label="Matches" value={formatNumber(data.metrics.totalMatches)} icon={Swords} />
            <MetricCard label="Active rooms" value={formatNumber(data.metrics.activeMatches)} icon={Activity} tone="green" />
            <MetricCard label="Pending reviews" value={formatNumber(data.metrics.pendingReviews)} icon={Shield} tone="red" />
            <MetricCard label="VEC issued" value={formatNumber(data.metrics.vecIssued)} icon={Coins} tone="amber" />
          </section>

          <div className="split-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>Recent users</h2>
              </div>
              <table>
                <thead>
                  <tr><th>User</th><th>Role</th><th>Level</th><th>Created</th></tr>
                </thead>
                <tbody>
                  {data.recentUsers.map((user: any) => (
                    <tr key={user.id}><td>{user.username}</td><td><Badge value={user.role} /></td><td>{user.level}</td><td>{formatDate(user.createdAt)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>Recent matches</h2>
              </div>
              <table>
                <thead>
                  <tr><th>Room</th><th>Mode</th><th>Status</th><th>Created</th></tr>
                </thead>
                <tbody>
                  {data.recentMatches.map((match: any) => (
                    <tr key={match.id}><td>{match.roomCode}</td><td>{match.mode}</td><td><Badge value={match.status} /></td><td>{formatDate(match.createdAt)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      )}
    </StatusBlock>
  );
}

function Badge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  return <span className={`badge ${normalized}`}>{value}</span>;
}

function UsersView({ session }: { session: Session }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const path = useMemo(() => `/admin/users?limit=50${search ? `&search=${encodeURIComponent(search)}` : ""}`, [search]);
  const state = useApi<any>(session, path, [search]);

  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-heading">
          <h2>Users</h2>
          <label className="search-box">
            <Search size={16} />
            <span className="sr-only">Search users</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search username or wallet" />
          </label>
        </div>
        <StatusBlock state={state}>
          {(data) => (
            <table>
              <thead>
                <tr><th>User</th><th>Role</th><th>Level</th><th>Coin</th><th>VEC</th></tr>
              </thead>
              <tbody>
                {data.users.map((user: any) => (
                  <tr key={user.id} className={selectedId === user.id ? "selected-row" : ""} onClick={() => setSelectedId(user.id)}>
                    <td><button className="row-button">{user.username}</button></td>
                    <td>{user.bannedAt ? <Badge value="Banned" /> : <Badge value={user.role} />}</td>
                    <td>{user.level}</td>
                    <td>{formatNumber(user.coinBalance)}</td>
                    <td>{formatNumber(user.vecUnlockedBalance + user.vecLockedBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </StatusBlock>
      </section>
      <UserDetail session={session} userId={selectedId} onChanged={() => state.reload()} />
    </div>
  );
}

function UserDetail({ session, userId, onChanged }: { session: Session; userId: string | null; onChanged: () => void }) {
  const state = useApi<any>(session, userId ? `/admin/users/${userId}` : "/admin/me", [userId]);
  const [message, setMessage] = useState<string | null>(null);

  async function post(path: string, body: unknown) {
    if (!userId) return;
    setMessage(null);
    try {
      await parseResponse(await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(body),
      }));
      setMessage("Saved");
      state.reload();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save");
    }
  }

  async function patchRole(role: string) {
    if (!userId) return;
    setMessage(null);
    try {
      await parseResponse(await fetch(`/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ role }),
      }));
      setMessage("Role updated");
      state.reload();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update role");
    }
  }

  if (!userId) {
    return (
      <aside className="panel detail-panel">
        <div className="empty-state">
          <UserCog size={34} />
          <strong>Select a user</strong>
          <span>User detail, balances, role, skins, and review history will appear here.</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel detail-panel">
      <StatusBlock state={state}>
        {(data) => (
          <div className="stack compact">
            <div className="detail-header">
              <div>
                <h2>{data.user.username}</h2>
                <span>{data.user.walletAddress ?? "No wallet linked"}</span>
              </div>
              {data.user.bannedAt ? <Badge value="Banned" /> : <Badge value={data.user.role} />}
            </div>
            {data.user.bannedAt ? <div className="status-inline">Ban reason: {data.user.banReason || "No reason provided."}</div> : null}
            {message ? <div className="status-inline" aria-live="polite">{message}</div> : null}
            <div className="button-row">
              <button onClick={() => patchRole("ADMIN")}>Make admin</button>
              <button onClick={() => patchRole("PLAYER")}>Make player</button>
            </div>
            <div className="balance-grid">
              <MetricCard label="Coin" value={formatNumber(data.user.coinBalance)} icon={Coins} />
              <MetricCard label="Unlocked VEC" value={formatNumber(data.user.vecUnlockedBalance)} icon={Coins} tone="amber" />
              <MetricCard label="Locked VEC" value={formatNumber(data.user.vecLockedBalance)} icon={Database} tone="green" />
            </div>
            <AdjustmentForm onSubmit={(body) => post(`/admin/users/${userId}/currency-adjustments`, body)} />
            <GrantSkinForm onSubmit={(body) => post(`/admin/users/${userId}/skins`, body)} />
            <h3>Recent transactions</h3>
            <MiniList items={data.user.currencyEvents} render={(item: any) => `${item.type} ${item.amount} ${item.currencyType} (${formatDate(item.createdAt)})`} />
            <h3>Anti-cheat history</h3>
            <MiniList items={data.antiCheatAssessments} render={(item: any) => `${item.label} score ${item.score.toFixed(2)} in ${item.participant.match.roomCode}`} />
          </div>
        )}
      </StatusBlock>
    </aside>
  );
}

function AdjustmentForm({ onSubmit }: { onSubmit: (body: unknown) => void }) {
  const [currencyType, setCurrencyType] = useState("COIN");
  const [vecBucket, setVecBucket] = useState("UNLOCKED");
  const [amount, setAmount] = useState("100");
  const [note, setNote] = useState("Admin adjustment");

  return (
    <form className="inline-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit({ currencyType, vecBucket, amount: Number(amount), note });
    }}>
      <h3>Currency adjustment</h3>
      <label>Currency<select value={currencyType} onChange={(event) => setCurrencyType(event.target.value)}><option>COIN</option><option>VEC</option></select></label>
      {currencyType === "VEC" ? <label>Bucket<select value={vecBucket} onChange={(event) => setVecBucket(event.target.value)}><option>UNLOCKED</option><option>LOCKED</option></select></label> : null}
      <label>Amount<input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>Note<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button className="primary-button">Apply</button>
    </form>
  );
}

function GrantSkinForm({ onSubmit }: { onSubmit: (body: unknown) => void }) {
  const [skinCode, setSkinCode] = useState("Female02");
  return (
    <form className="inline-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit({ skinCode });
    }}>
      <h3>Grant player skin</h3>
      <label>Skin code<input value={skinCode} onChange={(event) => setSkinCode(event.target.value)} /></label>
      <button>Grant skin</button>
    </form>
  );
}

function MiniList({ items, render }: { items: any[]; render: (item: any) => string }) {
  if (!items?.length) return <div className="muted">No records</div>;
  return <ul className="mini-list">{items.map((item) => <li key={item.id}>{render(item)}</li>)}</ul>;
}

function MatchesView({ session }: { session: Session }) {
  const state = useApi<any>(session, "/admin/matches?limit=50");
  return (
    <section className="panel">
      <div className="panel-heading"><h2>Matches</h2></div>
      <StatusBlock state={state}>
        {(data) => (
          <table>
            <thead><tr><th>Room</th><th>Mode</th><th>Status</th><th>Players</th><th>Kills</th><th>Created</th></tr></thead>
            <tbody>
              {data.matches.map((match: any) => (
                <tr key={match.id}><td>{match.roomCode}</td><td>{match.mode}</td><td><Badge value={match.status} /></td><td>{match._count.participants}</td><td>{match._count.killEvents}</td><td>{formatDate(match.createdAt)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </StatusBlock>
    </section>
  );
}

function TransactionsView({ session }: { session: Session }) {
  const state = useApi<any>(session, "/admin/transactions?limit=50");
  return (
    <section className="panel">
      <div className="panel-heading"><h2>Transactions</h2></div>
      <StatusBlock state={state}>
        {(data) => (
          <table>
            <thead><tr><th>User</th><th>Type</th><th>Currency</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {data.transactions.map((tx: any) => (
                <tr key={tx.id}><td>{tx.user.username}</td><td>{tx.type}</td><td>{tx.currencyType}{tx.vecBucket ? `/${tx.vecBucket}` : ""}</td><td>{tx.amount}</td><td><Badge value={tx.status} /></td><td>{formatDate(tx.createdAt)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </StatusBlock>
    </section>
  );
}

function AntiCheatView({ session }: { session: Session }) {
  const state = useApi<any>(session, "/admin/anticheat/assessments?limit=100");
  const [banReasons, setBanReasons] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  async function review(id: string, reviewStatus: string) {
    setActionError(null);
    await parseResponse(await fetch(`/admin/anticheat/assessments/${id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ reviewStatus }),
    }));
    state.reload();
  }

  async function banFromAssessment(id: string) {
    const reason = banReasons[id]?.trim();
    if (!reason) {
      setActionError("Enter a ban reason before banning the player.");
      return;
    }

    setActionError(null);
    await parseResponse(await fetch(`/admin/anticheat/assessments/${id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({
        reviewStatus: "Confirmed",
        reviewerNote: reason,
        banUser: true,
        banReason: reason,
      }),
    }));
    state.reload();
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Anti-cheat review</h2>
          <span className="muted">Review suspicious matches, then ban confirmed offenders with a visible reason.</span>
        </div>
      </div>
      {actionError ? <div className="inline-error">{actionError}</div> : null}
      <StatusBlock state={state}>
        {(data) => (
          <table className="review-table">
            <thead><tr><th>Player</th><th>Risk</th><th>Score</th><th>Match</th><th>Combat</th><th>Status</th><th>Decision</th></tr></thead>
            <tbody>
              {data.assessments.map((item: any) => {
                const hasAssessment = Boolean(item.id);
                const isReviewed = Boolean(item.reviewStatus);
                const isConfirmed = item.reviewStatus === "Confirmed";
                const isBanned = Boolean(item.participant.user?.bannedAt);
                const canBan = isConfirmed && item.participant.userId && !isBanned;

                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.participant.usernameSnapshot}</strong>
                      {isBanned ? <span className="subtle-line">Banned</span> : null}
                    </td>
                    <td><Badge value={item.label} /></td>
                    <td className="mono">{item.score.toFixed(3)}</td>
                    <td className="mono">{item.participant.match.roomCode}</td>
                    <td>{item.participant.kills} K / {item.participant.deaths} D</td>
                    <td>{hasAssessment ? (isReviewed ? <Badge value={item.reviewStatus} /> : <Badge value="Pending" />) : <Badge value="No flags" />}</td>
                    <td>
                      {!hasAssessment ? (
                        <span className="decision-note">Telemetry recorded. No review required.</span>
                      ) : !isReviewed ? (
                        <div className="review-actions">
                          <button className="primary-button" onClick={() => review(item.id, "Confirmed")}>Confirm violation</button>
                          <button onClick={() => review(item.id, "FalsePositive")}>False positive</button>
                        </div>
                      ) : isBanned ? (
                        <span className="decision-note">{item.participant.user?.banReason || "Player is banned."}</span>
                      ) : canBan ? (
                        <div className="ban-inline">
                          <input
                            value={banReasons[item.id] ?? ""}
                            onChange={(event) => setBanReasons((current) => ({ ...current, [item.id]: event.target.value }))}
                            placeholder="Reason shown to player"
                          />
                          <button className="danger-button" onClick={() => banFromAssessment(item.id)}>Ban player</button>
                        </div>
                      ) : (
                        <span className="decision-note">No further action</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </StatusBlock>
    </section>
  );
}

function NftView({ session }: { session: Session }) {
  const state = useApi<any>(session, "/admin/nft-mappings");
  return (
    <section className="panel">
      <div className="panel-heading"><h2>NFT and skin mappings</h2></div>
      <StatusBlock state={state}>
        {(data) => (
          <table>
            <thead><tr><th>Skin</th><th>Chain</th><th>Token</th><th>Standard</th><th>Active</th><th>Caches</th><th>Purchases</th></tr></thead>
            <tbody>
              {data.mappings.map((mapping: any) => (
                <tr key={mapping.id}><td>{mapping.skinId}</td><td>{mapping.chainId}</td><td>{mapping.tokenId}</td><td>{mapping.standard}</td><td><Badge value={mapping.active ? "ACTIVE" : "INACTIVE"} /></td><td>{mapping._count.userCaches}</td><td>{mapping._count.purchaseHistory}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </StatusBlock>
    </section>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(() => readStoredSession());
  const [view, setView] = useState<View>("overview");

  if (!session) return <LoginScreen onLogin={setSession} />;

  const ViewComponent = {
    overview: Overview,
    users: UsersView,
    matches: MatchesView,
    transactions: TransactionsView,
    anticheat: AntiCheatView,
    nft: NftView,
  }[view];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><Shield size={24} /><strong>VectoArena</strong></div>
        <nav aria-label="Admin navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon size={18} />{item.label}</button>;
          })}
        </nav>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">Operations Console</span>
            <h1>{navItems.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="session-pill">
            <BadgeCheck size={17} />
            <span>{session.user.username}</span>
            <button aria-label="Sign out" onClick={() => {
              window.localStorage.removeItem(storageKey);
              setSession(null);
            }}><LogOut size={17} /></button>
          </div>
        </header>
        <ViewComponent session={session} />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
