/**
 * Default session inactivity timeout (30 minutes).
 *
 * Deliberately generous: clients that never open a standalone SSE stream
 * (or whose stream fails to attach, as happens with mcp-remote) cannot
 * receive keep-alive pings, so their sessions are only refreshed by real
 * requests. Chat clients like Claude Desktop routinely sit idle for many
 * minutes between tool calls and cannot recover from an expired session
 * without a full restart.
 */
export const DEFAULT_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/** Default ping interval (30 seconds) - per MCP best practices */
export const DEFAULT_PING_INTERVAL_MS = 30 * 1000;

/** Max consecutive failed pings before considering session dead */
export const DEFAULT_MAX_FAILED_PINGS = 3;

export interface SessionConfig {
  /** Inactivity timeout in milliseconds */
  inactivityTimeoutMs: number;
  /** Ping interval in milliseconds (0 to disable) */
  pingIntervalMs: number;
  /** Max consecutive failed pings before session termination */
  maxFailedPings: number;
}

export interface SessionClientMetadata {
  /** Client name reported in the MCP initialize request. */
  clientName?: string;
  /** Client version reported in the MCP initialize request. */
  clientVersion?: string;
  /** Network peer address observed by the local HTTP server. */
  remoteAddress?: string;
  /** HTTP User-Agent observed during initialization. */
  userAgent?: string;
}

export interface Session extends SessionClientMetadata {
  id: string;
  /** Stable runtime grouping key for sessions from the same reported client. */
  clientKey: string;
  connectedAt: Date;
  lastActivity: Date;
  lastPingAt?: Date;
  lastPongAt?: Date;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  pingHandle?: ReturnType<typeof setInterval>;
  /** Number of consecutive failed ping attempts */
  failedPings: number;
  /** Number of post-initialization MCP requests observed for this session. */
  requestCount: number;
}

export interface ClientSummary extends SessionClientMetadata {
  key: string;
  connectedAt: Date;
  lastActivity: Date;
  sessions: Session[];
}

export interface BlockedClient extends SessionClientMetadata {
  key: string;
  blockedAt: Date;
}

function normalizedIdentityPart(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeRemoteAddress(value?: string): string {
  const normalized = normalizedIdentityPart(value);
  if (normalized.startsWith("::ffff:")) return normalized.slice("::ffff:".length);
  return normalized;
}

/**
 * Groups runtime MCP sessions by the identity visible to the server.
 * This is an administrative convenience, not an authentication boundary:
 * client name, version, and User-Agent are all self-reported and spoofable.
 */
export function getSessionClientKey(metadata: SessionClientMetadata): string {
  return [
    normalizeRemoteAddress(metadata.remoteAddress),
    normalizedIdentityPart(metadata.clientName),
    normalizedIdentityPart(metadata.clientVersion),
    normalizedIdentityPart(metadata.userAgent),
  ].join("\u001f");
}

type SessionListener = (sessions: Session[]) => void;
type RemovalCallback = (sessionId: string) => void | Promise<void>;
type PingCallback = (sessionId: string) => Promise<boolean>;

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private blockedClients: Map<string, BlockedClient> = new Map();
  private listeners: Set<SessionListener> = new Set();
  private removalCallback: RemovalCallback | null = null;
  private pingCallback: PingCallback | null = null;
  private config: SessionConfig = {
    inactivityTimeoutMs: DEFAULT_INACTIVITY_TIMEOUT_MS,
    pingIntervalMs: DEFAULT_PING_INTERVAL_MS,
    maxFailedPings: DEFAULT_MAX_FAILED_PINGS,
  };

  /**
   * Configure session manager settings
   */
  configure(config: Partial<SessionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<SessionConfig> {
    return { ...this.config };
  }

  add(sessionId: string, metadata: SessionClientMetadata = {}): boolean {
    // Don't add duplicate sessions
    if (this.sessions.has(sessionId)) {
      this.updateActivity(sessionId);
      return true;
    }

    const clientKey = getSessionClientKey(metadata);
    if (this.blockedClients.has(clientKey)) return false;

    const session: Session = {
      id: sessionId,
      clientKey,
      connectedAt: new Date(),
      lastActivity: new Date(),
      failedPings: 0,
      requestCount: 0,
      ...metadata,
    };
    this.resetTimeout(session);
    this.startPingInterval(session);
    this.sessions.set(sessionId, session);
    this.notifyListeners();
    return true;
  }

  remove(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.clearSessionTimers(session);

    // Delete from map FIRST to prevent re-entrancy issues
    // (e.g., if removalCallback triggers onsessionclosed which calls remove() again)
    this.sessions.delete(sessionId);
    this.notifyListeners();

    // Notify removal callback (e.g., to close transport) after removing from map
    if (this.removalCallback) {
      try {
        void Promise.resolve(this.removalCallback(sessionId)).catch((error) => {
          console.error("[MCP] Session removal callback error:", error);
        });
      } catch (error) {
        console.error("[MCP] Session removal callback error:", error);
      }
    }
  }

  updateActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      session.failedPings = 0; // Reset failed pings on activity
      this.resetTimeout(session);
    }
  }

  recordRequest(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.requestCount += 1;
    this.updateActivity(sessionId);
    this.notifyListeners();
  }

  /**
   * Record that a ping was sent to the session
   */
  recordPingSent(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastPingAt = new Date();
    }
  }

  /**
   * Record that a pong (ping response) was received from the session.
   * This confirms that the transport can currently answer a ping, but it does
   * not count as user/client activity. Otherwise an abandoned session with a
   * surviving SSE stream can keep itself alive forever despite the configured
   * inactivity timeout.
   */
  recordPongReceived(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastPongAt = new Date();
      session.failedPings = 0;
    }
  }

  /**
   * Record a failed ping attempt.
   *
   * Ping failures are diagnostic only and never terminate the session.
   * Over Streamable HTTP a server→client ping is only deliverable when the
   * client holds an open standalone SSE (GET) stream; clients without one
   * (mcp-remote/Claude Desktop among them) are healthy yet can never pong.
   * Killing their sessions on failed pings breaks them within minutes.
   * Dead sessions are reaped by the inactivity timeout instead.
   */
  recordPingFailed(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Cap the counter — for clients that can never pong it would otherwise
    // grow with uptime and stop meaning "consecutive failures".
    session.failedPings = Math.min(
      session.failedPings + 1,
      this.config.maxFailedPings
    );
  }

  updateClientInfo(sessionId: string, clientName?: string, clientVersion?: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.clientName = clientName;
      session.clientVersion = clientVersion;
      session.clientKey = getSessionClientKey(session);
      if (this.blockedClients.has(session.clientKey)) {
        this.remove(sessionId);
        return;
      }
      this.notifyListeners();
    }
  }

  private clearSessionTimers(session: Session): void {
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
      session.timeoutHandle = undefined;
    }
    if (session.pingHandle) {
      clearInterval(session.pingHandle);
      session.pingHandle = undefined;
    }
  }

  private resetTimeout(session: Session): void {
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }
    session.timeoutHandle = setTimeout(() => {
      this.remove(session.id);
    }, this.config.inactivityTimeoutMs);
  }

  private startPingInterval(session: Session): void {
    // Don't start ping if interval is 0 (disabled) or no callback
    if (this.config.pingIntervalMs <= 0) return;

    session.pingHandle = setInterval(async () => {
      if (!this.pingCallback) return;

      this.recordPingSent(session.id);
      try {
        const success = await this.pingCallback(session.id);
        if (success) {
          this.recordPongReceived(session.id);
        } else {
          this.recordPingFailed(session.id);
        }
      } catch (error) {
        console.error(`[MCP] Ping error for session ${session.id.slice(0, 8)}...:`, error);
        this.recordPingFailed(session.id);
      }
    }, this.config.pingIntervalMs);
  }

  getAll(): Session[] {
    return [...this.sessions.values()];
  }

  getCount(): number {
    return this.sessions.size;
  }

  getClients(): ClientSummary[] {
    const clients = new Map<string, ClientSummary>();
    for (const session of this.sessions.values()) {
      const existing = clients.get(session.clientKey);
      if (existing) {
        existing.sessions.push(session);
        if (session.connectedAt < existing.connectedAt) existing.connectedAt = session.connectedAt;
        if (session.lastActivity > existing.lastActivity) existing.lastActivity = session.lastActivity;
        continue;
      }
      clients.set(session.clientKey, {
        key: session.clientKey,
        clientName: session.clientName,
        clientVersion: session.clientVersion,
        remoteAddress: session.remoteAddress,
        userAgent: session.userAgent,
        connectedAt: session.connectedAt,
        lastActivity: session.lastActivity,
        sessions: [session],
      });
    }
    return [...clients.values()]
      .map((client) => ({
        ...client,
        sessions: [...client.sessions].sort(
          (left, right) => right.lastActivity.getTime() - left.lastActivity.getTime()
        ),
      }))
      .sort((left, right) => right.lastActivity.getTime() - left.lastActivity.getTime());
  }

  getClientCount(): number {
    return this.getClients().length;
  }

  disconnectSession(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.remove(sessionId);
    return true;
  }

  disconnectClient(clientKey: string): number {
    const sessionIds = [...this.sessions.values()]
      .filter((session) => session.clientKey === clientKey)
      .map((session) => session.id);
    sessionIds.forEach((sessionId) => this.remove(sessionId));
    return sessionIds.length;
  }

  blockClient(clientKey: string): BlockedClient | null {
    const client = this.getClients().find((candidate) => candidate.key === clientKey);
    if (!client) return null;
    const blocked: BlockedClient = {
      key: client.key,
      clientName: client.clientName,
      clientVersion: client.clientVersion,
      remoteAddress: client.remoteAddress,
      userAgent: client.userAgent,
      blockedAt: new Date(),
    };
    this.blockedClients.set(clientKey, blocked);
    this.disconnectClient(clientKey);
    this.notifyListeners();
    return blocked;
  }

  unblockClient(clientKey: string): boolean {
    const removed = this.blockedClients.delete(clientKey);
    if (removed) this.notifyListeners();
    return removed;
  }

  isClientBlocked(metadata: SessionClientMetadata): boolean {
    return this.blockedClients.has(getSessionClientKey(metadata));
  }

  getBlockedClients(): BlockedClient[] {
    return [...this.blockedClients.values()]
      .map((client) => ({ ...client }))
      .sort((left, right) => right.blockedAt.getTime() - left.blockedAt.getTime());
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.getAll());
    return () => this.listeners.delete(listener);
  }

  /**
   * Sets a callback to be invoked when a session is removed (timeout or explicit).
   * Used to synchronize transport cleanup with session removal.
   */
  setRemovalCallback(callback: RemovalCallback | null): void {
    this.removalCallback = callback;
  }

  /**
   * Sets a callback to be invoked for pinging a session.
   * The callback should send an MCP ping request and return true if successful.
   */
  setPingCallback(callback: PingCallback | null): void {
    this.pingCallback = callback;
  }

  private notifyListeners(): void {
    const sessions = this.getAll();
    this.listeners.forEach((listener) => {
      try {
        listener(sessions);
      } catch (error) {
        console.error("[MCP] Session listener error:", error);
      }
    });
  }

  /**
   * Clears all sessions and timeouts. Used during plugin unload.
   */
  clear(options: { keepListeners?: boolean } = {}): void {
    for (const session of this.sessions.values()) {
      this.clearSessionTimers(session);
    }
    this.sessions.clear();
    this.blockedClients.clear();
    this.pingCallback = null;
    this.removalCallback = null;
    if (options.keepListeners) this.notifyListeners();
    else this.listeners.clear();
  }
}

export const sessionManager = new SessionManager();
