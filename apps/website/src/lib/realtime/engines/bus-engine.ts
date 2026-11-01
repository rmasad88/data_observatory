import type { Store } from '@tanstack/react-store';

import type { BusMessage, EngineRole, EngineStoreState, HelloBusMessage } from '../types';

const RECONNECT_DELAY_MS = 1_500;

// Shared websocket transport used by both control and screen engines.
export abstract class BusEngine<TStoreState extends EngineStoreState = EngineStoreState> {
    private socket: WebSocket | null = null;
    // window.setTimeout returns a number in the browser. Stated explicitly
    // because ReturnType<typeof setTimeout> means Node's Timeout object when
    // Node's types are loaded, as they are for tests.
    private reconnectTimer: number | null = null;
    private readonly role: EngineRole;
    protected readonly store: Store<TStoreState>;

    protected constructor(role: EngineRole, store: Store<TStoreState>) {
        this.role = role;
        this.store = store;
        // Engines can be imported during SSR/build, so gate browser-only APIs.
        if (this.canUseBrowserSockets()) {
            this.connect();
        }
    }

    private connect() {
        if (!this.canUseBrowserSockets()) return;

        // Reuse an active connection when possible.
        const existing = this.socket;
        if (existing) {
            if (
                existing.readyState === WebSocket.OPEN ||
                existing.readyState === WebSocket.CONNECTING
            ) {
                return;
            }
            this.socket = null;
        }

        this.clearReconnectTimer();
        this.store.setState((prev) => ({
            ...prev,
            connection: 'connecting',
            lastError: null
        }));

        // Match ws/wss to current page protocol.
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${protocol}://${window.location.host}/bus`;
        const socket = new WebSocket(url);
        this.socket = socket;

        socket.onopen = () => {
            if (this.socket !== socket) return;
            this.store.setState((prev) => ({
                ...prev,
                connection: 'open',
                lastError: null
            }));
        };

        socket.onmessage = (event) => {
            if (this.socket !== socket) return;
            this.handleSocketMessage(event.data, socket);
        };

        socket.onerror = () => {
            if (this.socket !== socket) return;
            this.store.setState((prev) => ({
                ...prev,
                connection: 'error',
                lastError: 'WebSocket error'
            }));
        };

        socket.onclose = () => {
            if (this.socket !== socket) return;
            this.socket = null;
            this.store.setState((prev) => ({
                ...prev,
                connection: 'closed'
            }));
            this.scheduleReconnect();
        };
    }

    send(message: BusMessage) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify(message));
    }

    protected onMessage(_message: BusMessage) {
        // Hook for specialized screen/control handling.
    }

    protected onHello(_hello: HelloBusMessage) {
        // Hook for engine-specific initialization from hello payload.
    }

    protected shouldIgnoreSelfMessages() {
        return true;
    }

    protected setPeerId(peerId: string) {
        this.store.setState((prev) => ({
            ...prev,
            peerId
        }));
    }

    protected getPeerId() {
        return this.store.state.peerId;
    }

    private handleSocketMessage(data: unknown, sourceSocket: WebSocket) {
        // Accept multiple browser payload types to make transport robust across environments.
        if (typeof data === 'string') {
            this.processParsedMessage(data, sourceSocket);
            return;
        }

        if (typeof Blob !== 'undefined' && data instanceof Blob) {
            data.text()
                .then((text) => {
                    if (this.socket !== sourceSocket) return;
                    this.processParsedMessage(text, sourceSocket);
                })
                .catch(() => {
                    this.store.setState((prev) => ({
                        ...prev,
                        connection: 'error',
                        lastError: 'Invalid message payload'
                    }));
                });
            return;
        }

        if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
            const text = new TextDecoder().decode(data);
            this.processParsedMessage(text, sourceSocket);
        }
    }

    private processParsedMessage(rawMessage: string, sourceSocket: WebSocket) {
        if (this.socket !== sourceSocket) return;
        const parsed = this.parseMessage(rawMessage);
        if (!parsed) return;

        this.store.setState((prev) => ({
            ...prev,
            messageCount: prev.messageCount + 1,
            lastMessageType: parsed.type,
            lastMessageAt: Date.now()
        }));

        if (this.shouldFilterMessage(parsed)) return;
        this.onMessage(parsed);
    }

    private shouldFilterMessage(message: BusMessage) {
        if (message.type === 'hello') {
            const hello = message as HelloBusMessage;
            if (typeof hello.peerId === 'string' && hello.peerId.length > 0) {
                this.setPeerId(hello.peerId);
            }
            this.onHello(hello);
            return true;
        }

        // Ignore own broadcast echo unless a subclass opts out.
        if (
            this.shouldIgnoreSelfMessages() &&
            typeof message.peerId === 'string' &&
            message.peerId === this.getPeerId()
        ) {
            return true;
        }

        return false;
    }

    private parseMessage(data: string): BusMessage | null {
        try {
            const parsed = JSON.parse(data) as unknown;
            if (
                typeof parsed === 'object' &&
                parsed !== null &&
                'type' in parsed &&
                typeof parsed.type === 'string'
            ) {
                return parsed as BusMessage;
            }
            return null;
        } catch {
            this.store.setState((prev) => ({
                ...prev,
                connection: 'error',
                lastError: 'Invalid JSON message'
            }));
            return null;
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimer || !this.canUseBrowserSockets()) return;
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, RECONNECT_DELAY_MS);
    }

    private clearReconnectTimer() {
        if (!this.reconnectTimer) return;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    getRole() {
        return this.role;
    }

    private canUseBrowserSockets() {
        return (
            typeof window !== 'undefined' &&
            typeof window.location !== 'undefined' &&
            typeof window.setTimeout === 'function' &&
            typeof WebSocket !== 'undefined'
        );
    }
}
