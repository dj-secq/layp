//! Phone listener. One accept loop, one held `/sync`, and no SQLite.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use rand::{Rng, RngCore};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::CStr;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, watch, Notify};
use tokio::task::JoinHandle;
use tokio::time::timeout;

const PORT_FIRST: u16 = 47321;
const PORT_LAST: u16 = 47340;
const HEADER_CAP: usize = 8 * 1024;
const BODY_CAP: u64 = 32 * 1024 * 1024;
const READ_LIMIT: Duration = Duration::from_secs(5);
const REPLY_LIMIT: Duration = Duration::from_secs(10);
const HOLD_LIMIT: Duration = Duration::from_secs(15);
const OFFER_TTL: Duration = Duration::from_secs(5 * 60);
const AAD: &[u8] = b"layp-sync-v1";
const SECRET_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const KEY_FILE: &str = "phone.key";
const HEX: &[u8; 16] = b"0123456789abcdef";

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum HttpFail {
    Timeout,
    TooLarge,
    Bad,
    Closed,
}

#[derive(Debug)]
pub(crate) struct HttpRequest {
    pub method: String,
    pub path: String,
    pub body: Vec<u8>,
}

struct Head {
    method: String,
    path: String,
    content_length: Option<u64>,
    transfer_encoding: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Ipv4OnIface {
    pub name: String,
    pub addr: Ipv4Addr,
}

struct Offer {
    secret: String,
    expires_at: SystemTime,
    expires_iso: String,
    used: bool,
    failures: u8,
    burned: bool,
}

impl Offer {
    fn fresh(secret: String, expires_at: SystemTime, expires_iso: String) -> Self {
        Self { secret, expires_at, expires_iso, used: false, failures: 0, burned: false }
    }

    /// 200 to pair, 410 for a second use of a secret that already paired, 401 otherwise.
    fn judge(&mut self, secret: &str, now: SystemTime) -> u16 {
        if self.burned {
            return 401;
        }
        if self.used {
            return if secret == self.secret { 410 } else { 401 };
        }
        if now >= self.expires_at {
            return 401;
        }
        if secret != self.secret {
            self.failures = self.failures.saturating_add(1);
            if self.failures >= 8 {
                self.burned = true;
            }
            return 401;
        }
        200
    }
}

struct Gate {
    /// A sync request owns the slot, including a long-poll.
    held: bool,
    /// A contender or `phone_kick` arrived while the slot was held.
    kick: bool,
}

struct Running {
    host: String,
    port: u16,
    other: Vec<String>,
    shutdown: watch::Sender<bool>,
    task: JoinHandle<()>,
    alive: ArcFlag,
    conns: ArcConns,
}

type ArcFlag = std::sync::Arc<AtomicBool>;
type ArcConns = std::sync::Arc<Mutex<Vec<JoinHandle<()>>>>;

struct Inner {
    run: Option<Running>,
    offer: Option<Offer>,
    replies: HashMap<String, oneshot::Sender<Option<String>>>,
    gate: Gate,
    next_id: u64,
    generation: u64,
    /// Bumped when the listener stops so an aborted sync cannot clear a newer slot.
    slot_generation: u64,
    starting: bool,
}

struct Shared {
    inner: Mutex<Inner>,
    wake: Notify,
}

pub struct PhoneLink {
    shared: std::sync::Arc<Shared>,
}

struct SlotGuard<'a> {
    shared: &'a Shared,
    generation: u64,
}

impl Drop for SlotGuard<'_> {
    fn drop(&mut self) {
        {
            let mut inner = self.shared.lock();
            if inner.slot_generation == self.generation {
                inner.gate.held = false;
            }
        }
        self.shared.wake.notify_waiters();
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneBind {
    host: String,
    port: u16,
    other_ipv4: Vec<String>,
}

impl PhoneBind {
    fn idle() -> Self {
        Self { host: String::new(), port: 0, other_ipv4: Vec::new() }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneStatus {
    on: bool,
    host: String,
    port: u16,
    other_ipv4: Vec<String>,
    offer_expires_at: Option<String>,
    key_exists: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingOffer {
    code: String,
    expires_at: String,
}

struct HostPick {
    host: String,
    other: Vec<String>,
}

enum Start {
    Already(PhoneBind),
    Begun(u64),
}

enum PairOutcome {
    Accept,
    Gone,
    Deny,
}

impl PhoneLink {
    pub fn new() -> Self {
        Self {
            shared: std::sync::Arc::new(Shared {
                inner: Mutex::new(Inner {
                    run: None,
                    offer: None,
                    replies: HashMap::new(),
                    gate: Gate { held: false, kick: false },
                    next_id: 0,
                    generation: 0,
                    slot_generation: 0,
                    starting: false,
                }),
                wake: Notify::new(),
            }),
        }
    }

    async fn set_enabled(&self, app: &AppHandle, on: bool) -> Result<PhoneBind, String> {
        if !on {
            self.stop();
            return Ok(PhoneBind::idle());
        }
        let generation = match self.wait_begin().await? {
            Start::Already(bind) => return Ok(bind),
            Start::Begun(generation) => generation,
        };
        let bound = match bind_new(app).await {
            Ok(value) => value,
            Err(err) => {
                self.cancel_start(generation);
                return Err(err);
            }
        };
        let (pick, listener, port, dir) = bound;
        let running = launch(app.clone(), dir, pick, listener, port, std::sync::Arc::clone(&self.shared));
        match self.finish_start(generation, running) {
            Ok(bind) => Ok(bind),
            Err(running) => {
                abort_running(running);
                Err("Phone did not stay on.".to_string())
            }
        }
    }

    async fn wait_begin(&self) -> Result<Start, String> {
        for _ in 0..100 {
            match self.begin_start() {
                Ok(start) => return Ok(start),
                Err(()) => tokio::time::sleep(Duration::from_millis(20)).await,
            }
        }
        Err("Phone is still starting.".to_string())
    }

    fn begin_start(&self) -> Result<Start, ()> {
        let mut inner = self.shared.lock();
        if let Some(run) = &inner.run {
            return Ok(Start::Already(PhoneBind {
                host: run.host.clone(),
                port: run.port,
                other_ipv4: run.other.clone(),
            }));
        }
        if inner.starting {
            return Err(());
        }
        inner.generation = inner.generation.wrapping_add(1);
        inner.starting = true;
        Ok(Start::Begun(inner.generation))
    }

    fn cancel_start(&self, generation: u64) {
        let mut inner = self.shared.lock();
        if inner.generation == generation {
            inner.starting = false;
        }
    }

    fn finish_start(&self, generation: u64, running: Running) -> Result<PhoneBind, Running> {
        let bind = PhoneBind {
            host: running.host.clone(),
            port: running.port,
            other_ipv4: running.other.clone(),
        };
        let mut inner = self.shared.lock();
        if inner.generation != generation {
            return Err(running);
        }
        inner.starting = false;
        inner.run = Some(running);
        Ok(bind)
    }

    fn stop(&self) {
        let running = {
            let mut inner = self.shared.lock();
            inner.generation = inner.generation.wrapping_add(1);
            inner.slot_generation = inner.slot_generation.wrapping_add(1);
            inner.starting = false;
            inner.offer = None;
            inner.gate.kick = false;
            inner.gate.held = false;
            inner.run.take()
        };
        self.shared.wake.notify_waiters();
        if let Some(running) = running {
            abort_running(running);
        }
    }

    fn status(&self, dir: &Path) -> PhoneStatus {
        let inner = self.shared.lock();
        let (on, host, port, other) = if let Some(run) = &inner.run {
            (true, run.host.clone(), run.port, run.other.clone())
        } else {
            (false, String::new(), 0, Vec::new())
        };
        PhoneStatus {
            on,
            host,
            port,
            other_ipv4: other,
            offer_expires_at: inner.offer.as_ref().map(|offer| offer.expires_iso.clone()),
            key_exists: key_file(dir).is_file(),
        }
    }

    fn mint(&self, dir: &Path, replace: bool) -> Result<PairingOffer, String> {
        reject_mint(key_file(dir).is_file(), replace)?;
        let mut inner = self.shared.lock();
        let Some(run) = inner.run.as_ref() else {
            return Err("Turn Phone on first.".to_string());
        };
        let host = run.host.clone();
        let port = run.port;
        let (when, iso) = expiry_from_now();
        let secret = random_secret();
        let code = pairing_code(&host, port, &secret);
        inner.offer = Some(Offer::fresh(secret, when, iso.clone()));
        Ok(PairingOffer { code, expires_at: iso })
    }

    fn clear_offer(&self) {
        self.shared.lock().offer = None;
    }

    fn kick(&self) {
        {
            let mut inner = self.shared.lock();
            if inner.gate.held {
                inner.gate.kick = true;
            }
        }
        self.shared.wake.notify_waiters();
    }

    fn take_reply(&self, id: &str, body: Option<String>) {
        if let Some(sender) = self.shared.lock().replies.remove(id) {
            let _ = sender.send(body);
        }
    }
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|err| err.into_inner())
    }
}

fn abort_running(running: Running) {
    running.alive.store(false, Ordering::Relaxed);
    let _ = running.shutdown.send(true);
    running.task.abort();
    let mut conns = running.conns.lock().unwrap_or_else(|err| err.into_inner());
    for handle in conns.drain(..) {
        handle.abort();
    }
}

async fn bind_new(app: &AppHandle) -> Result<(HostPick, TcpListener, u16, PathBuf), String> {
    let dir = crate::config_dir(app)?;
    let pick = discover_host()?;
    let (listener, port) = bind_listener().await?;
    Ok((pick, listener, port, dir))
}

fn launch(app: AppHandle, dir: PathBuf, pick: HostPick, listener: TcpListener, port: u16, shared: std::sync::Arc<Shared>) -> Running {
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let alive = std::sync::Arc::new(AtomicBool::new(true));
    let conns = std::sync::Arc::new(Mutex::new(Vec::new()));
    let task = spawn_accept(
        listener,
        shutdown_rx,
        app,
        dir,
        std::sync::Arc::clone(&shared),
        std::sync::Arc::clone(&alive),
        std::sync::Arc::clone(&conns),
    );
    Running {
        host: pick.host,
        port,
        other: pick.other,
        shutdown: shutdown_tx,
        task,
        alive,
        conns,
    }
}

fn spawn_accept(
    listener: TcpListener,
    mut shutdown: watch::Receiver<bool>,
    app: AppHandle,
    dir: PathBuf,
    shared: std::sync::Arc<Shared>,
    alive: ArcFlag,
    conns: ArcConns,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() {
                        break;
                    }
                }
                accepted = listener.accept() => {
                    let (stream, peer) = match accepted {
                        Ok(pair) => pair,
                        Err(_) => {
                            if !alive.load(Ordering::Relaxed) {
                                break;
                            }
                            log::error!("phone link failed");
                            continue;
                        }
                    };
                    if !private_peer(peer) {
                        log::error!("phone link failed");
                        continue;
                    }
                    let app = app.clone();
                    let dir = dir.clone();
                    let shared = std::sync::Arc::clone(&shared);
                    let alive = std::sync::Arc::clone(&alive);
                    let handle = tokio::spawn(async move {
                        serve(stream, app, dir, shared, alive).await;
                    });
                    let mut guard = conns.lock().unwrap_or_else(|err| err.into_inner());
                    guard.retain(|item| !item.is_finished());
                    guard.push(handle);
                }
            }
        }
    })
}

fn private_peer(peer: SocketAddr) -> bool {
    is_private_peer(peer.ip())
}

async fn serve(mut stream: TcpStream, app: AppHandle, dir: PathBuf, shared: std::sync::Arc<Shared>, alive: ArcFlag) {
    let _ = stream.set_nodelay(true);
    let request = match read_http(&mut stream).await {
        Ok(request) => request,
        Err(_) => {
            log::error!("phone link failed");
            return;
        }
    };
    if !alive.load(Ordering::Relaxed) {
        return;
    }
    let bytes = if response_status(&request.method, &request.path) == 404 {
        http_empty(404)
    } else if request.path == "/pair" {
        handle_pair(&request.body, &app, &shared, &dir).await
    } else {
        let _slot = acquire_slot(&shared).await;
        if !alive.load(Ordering::Relaxed) {
            return;
        }
        process_sync(&request.body, &app, &shared, &dir, &alive).await
    };
    let _ = stream.write_all(&bytes).await;
    let _ = stream.shutdown().await;
}

async fn acquire_slot(shared: &Shared) -> SlotGuard<'_> {
    loop {
        let notified = shared.wake.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let generation = {
            let mut inner = shared.lock();
            if !inner.gate.held {
                inner.gate.held = true;
                inner.gate.kick = false;
                Some(inner.slot_generation)
            } else {
                inner.gate.kick = true;
                None
            }
        };
        if let Some(generation) = generation {
            return SlotGuard { shared, generation };
        }
        shared.wake.notify_waiters();
        notified.await;
    }
}

async fn hold_for_changes(shared: &Shared) {
    let deadline = tokio::time::Instant::now() + HOLD_LIMIT;
    loop {
        let notified = shared.wake.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        {
            let mut inner = shared.lock();
            if inner.gate.kick {
                inner.gate.kick = false;
                return;
            }
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return;
        }
        tokio::select! {
            _ = tokio::time::sleep(remaining) => return,
            _ = notified => {}
        }
    }
}

async fn handle_pair(body: &[u8], app: &AppHandle, shared: &Shared, dir: &Path) -> Vec<u8> {
    let Some((secret, name)) = parse_pair_body(body) else {
        log::error!("phone link failed");
        return http_empty(401);
    };
    let outcome = {
        let mut inner = shared.lock();
        match inner.offer.as_mut() {
            Some(offer) => match offer.judge(&secret, SystemTime::now()) {
                200 => {
                    offer.used = true;
                    PairOutcome::Accept
                }
                410 => PairOutcome::Gone,
                _ => PairOutcome::Deny,
            },
            None => PairOutcome::Deny,
        }
    };
    match outcome {
        PairOutcome::Gone => http_empty(410),
        PairOutcome::Deny => {
            log::error!("phone link failed");
            http_empty(401)
        }
        PairOutcome::Accept => finish_pair(app, shared, dir, &secret, &name),
    }
}

fn finish_pair(app: &AppHandle, shared: &Shared, dir: &Path, secret: &str, name: &str) -> Vec<u8> {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    if write_key(dir, &key).is_err() {
        let mut inner = shared.lock();
        if let Some(offer) = inner.offer.as_mut() {
            if offer.secret == secret {
                offer.used = false;
            }
        }
        log::error!("phone link failed");
        return http_empty(503);
    }
    let paired_at = crate::db_tx::now_iso();
    let _ = app.emit(
        "phone-paired",
        json!({
            "name": name,
            "keyHash": sha256_hex(&key),
            "pairedAt": paired_at,
        }),
    );
    let body = json!({
        "phoneId": "phone",
        "key": STANDARD.encode(key),
    })
    .to_string();
    http(200, "OK", body.as_bytes(), true)
}

async fn process_sync(body: &[u8], app: &AppHandle, shared: &Shared, dir: &Path, alive: &AtomicBool) -> Vec<u8> {
    let key = match std::fs::read(key_file(dir)) {
        Ok(bytes) => match open_sync_key(Some(&bytes)) {
            Ok(key) => key,
            Err(status) => {
                log::error!("phone link failed");
                return http_empty(status);
            }
        },
        Err(_) => {
            log::error!("phone link failed");
            return http_empty(401);
        }
    };
    let plain = match decrypt_request(&key, body) {
        Ok(plain) => plain,
        Err(()) => {
            log::error!("phone link failed");
            return http_empty(401);
        }
    };
    let request: Value = match serde_json::from_slice(&plain) {
        Ok(value) => value,
        Err(_) => {
            log::error!("phone link failed");
            return http_empty(401);
        }
    };
    if request.get("phoneId").and_then(|value| value.as_str()) != Some("phone") {
        log::error!("phone link failed");
        return http_empty(401);
    }
    let have = cursor_value(&request, "have");
    let want_ack = cursor_value(&request, "wantAck");
    let rows = array_value(&request, "rows");
    let deletions = array_value(&request, "deletions");
    let wait = request.get("wait").and_then(|value| value.as_bool()).unwrap_or(false);
    let first = match push_to_ui(app, shared, "apply", &have, &want_ack, &rows, &deletions).await {
        Ok(body) => body,
        Err(status) => return http_empty(status),
    };
    let parsed: Value = match serde_json::from_str(&first) {
        Ok(value) => value,
        Err(_) => {
            log::error!("phone link failed");
            return http_empty(503);
        }
    };
    let (rows_empty, deletions_empty) = match (
        parsed.get("rows").and_then(|value| value.as_array()),
        parsed.get("deletions").and_then(|value| value.as_array()),
    ) {
        (Some(rows), Some(deletions)) => (rows.is_empty(), deletions.is_empty()),
        _ => {
            log::error!("phone link failed");
            return http_empty(503);
        }
    };
    let final_plain = if wait && rows_empty && deletions_empty {
        hold_for_changes(shared).await;
        if !alive.load(Ordering::Relaxed) {
            log::error!("phone link failed");
            return http_empty(503);
        }
        let poll_have = cursor_value(&parsed, "have");
        let empty = json!([]);
        match push_to_ui(app, shared, "poll", &poll_have, &want_ack, &empty, &empty).await {
            Ok(body) => body,
            Err(status) => return http_empty(status),
        }
    } else {
        first
    };
    match encrypt_reply(&key, &final_plain) {
        Ok(wire) => {
            let _ = app.emit("phone-sync", json!({}));
            http(200, "OK", &wire, true)
        }
        Err(()) => {
            log::error!("phone link failed");
            http_empty(503)
        }
    }
}

async fn push_to_ui(
    app: &AppHandle,
    shared: &Shared,
    phase: &str,
    have: &Value,
    want_ack: &Value,
    rows: &Value,
    deletions: &Value,
) -> Result<String, u16> {
    let (id, rx) = {
        let mut inner = shared.lock();
        inner.next_id = inner.next_id.wrapping_add(1);
        let id = inner.next_id.to_string();
        let (tx, rx) = oneshot::channel();
        inner.replies.insert(id.clone(), tx);
        (id, rx)
    };
    let payload = json!({
        "phase": phase,
        "id": id,
        "have": have,
        "wantAck": want_ack,
        "rows": rows,
        "deletions": deletions,
    });
    if app.emit("phone-push", payload).is_err() {
        shared.lock().replies.remove(&id);
        log::error!("phone link failed");
        return Err(503);
    }
    match timeout(REPLY_LIMIT, rx).await {
        Ok(Ok(Some(body))) => Ok(body),
        _ => {
            shared.lock().replies.remove(&id);
            log::error!("phone link failed");
            Err(503)
        }
    }
}

pub(crate) fn is_private_peer(addr: IpAddr) -> bool {
    match addr {
        IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            a == 10 || (a == 172 && (b & 0xf0) == 16) || (a == 192 && b == 168) || (a == 169 && b == 254)
        }
        IpAddr::V6(ip) => is_ula_or_link_local(ip),
    }
}

fn is_ula_or_link_local(ip: Ipv6Addr) -> bool {
    let octets = ip.octets();
    (octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80) || (octets[0] & 0xfe) == 0xfc
}

pub(crate) fn default_route_iface(table: &str) -> Option<String> {
    let mut best: Option<(u32, String)> = None;
    for line in table.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 7 || fields[1] != "00000000" {
            continue;
        }
        let Ok(metric) = fields[6].parse::<u32>() else {
            continue;
        };
        let replace = match &best {
            Some((current, _)) => metric < *current,
            None => true,
        };
        if replace {
            best = Some((metric, fields[0].to_string()));
        }
    }
    best.map(|(_, name)| name)
}

pub(crate) fn pick_host(iface: &str, addresses: &[Ipv4OnIface]) -> Option<Ipv4Addr> {
    addresses
        .iter()
        .find(|item| item.name == iface && !item.addr.is_unspecified())
        .map(|item| item.addr)
}

pub(crate) fn other_ipv4(iface: &str, chosen: Ipv4Addr, addresses: &[Ipv4OnIface]) -> Vec<String> {
    let mut out = Vec::new();
    for item in addresses {
        if item.addr.is_unspecified() || item.addr.is_loopback() {
            continue;
        }
        if item.name == iface && item.addr == chosen {
            continue;
        }
        let text = item.addr.to_string();
        if !out.contains(&text) {
            out.push(text);
        }
    }
    out
}

fn discover_host() -> Result<HostPick, String> {
    let table = std::fs::read_to_string("/proc/net/route").map_err(|_| "No IPv4 address on the default route.".to_string())?;
    let iface = default_route_iface(&table).ok_or_else(|| "No IPv4 address on the default route.".to_string())?;
    let addresses = ipv4_addresses().map_err(|_| "No IPv4 address on the default route.".to_string())?;
    let host = pick_host(&iface, &addresses).ok_or_else(|| "No IPv4 address on the default route.".to_string())?;
    Ok(HostPick { other: other_ipv4(&iface, host, &addresses), host: host.to_string() })
}

fn ipv4_addresses() -> Result<Vec<Ipv4OnIface>, ()> {
    unsafe {
        let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut head) != 0 {
            return Err(());
        }
        let mut out = Vec::new();
        let mut cursor = head;
        while !cursor.is_null() {
            let item = &*cursor;
            if !item.ifa_addr.is_null() && (*item.ifa_addr).sa_family == libc::AF_INET as libc::sa_family_t {
                let sin = &*(item.ifa_addr as *const libc::sockaddr_in);
                // `s_addr` is network order. `from_be` is the numeric value `Ipv4Addr::from` expects.
                let addr = Ipv4Addr::from(u32::from_be(sin.sin_addr.s_addr));
                if !item.ifa_name.is_null() {
                    if let Ok(name) = CStr::from_ptr(item.ifa_name).to_str() {
                        out.push(Ipv4OnIface { name: name.to_string(), addr });
                    }
                }
            }
            cursor = item.ifa_next;
        }
        libc::freeifaddrs(head);
        Ok(out)
    }
}

async fn bind_listener() -> Result<(TcpListener, u16), String> {
    for port in PORT_FIRST..=PORT_LAST {
        if let Ok(listener) = TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).await {
            return Ok((listener, port));
        }
    }
    Err("Could not listen on ports 47321-47340.".to_string())
}

pub(crate) async fn read_http<R: AsyncRead + Unpin>(reader: &mut R) -> Result<HttpRequest, HttpFail> {
    let header = match timeout(READ_LIMIT, read_header_bytes(reader)).await {
        Ok(result) => result?,
        Err(_) => return Err(HttpFail::Timeout),
    };
    let parsed = parse_header(&header)?;
    if parsed.transfer_encoding {
        return Err(HttpFail::Bad);
    }
    let Some(length) = parsed.content_length else {
        return Err(HttpFail::Bad);
    };
    if length > BODY_CAP {
        return Err(HttpFail::TooLarge);
    }
    let mut body = vec![0u8; length as usize];
    if length > 0 {
        match timeout(READ_LIMIT, reader.read_exact(&mut body)).await {
            Ok(Ok(_)) => {}
            Ok(Err(_)) => return Err(HttpFail::Closed),
            Err(_) => return Err(HttpFail::Timeout),
        }
    }
    Ok(HttpRequest { method: parsed.method, path: parsed.path, body })
}

async fn read_header_bytes<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Vec<u8>, HttpFail> {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        let read = reader.read(&mut byte).await.map_err(|_| HttpFail::Closed)?;
        if read == 0 {
            return Err(HttpFail::Closed);
        }
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") {
            return Ok(buf);
        }
        if buf.len() >= HEADER_CAP {
            return Err(HttpFail::TooLarge);
        }
    }
}

fn parse_header(bytes: &[u8]) -> Result<Head, HttpFail> {
    let text = std::str::from_utf8(bytes).map_err(|_| HttpFail::Bad)?;
    let (start, rest) = text.split_once("\r\n").ok_or(HttpFail::Bad)?;
    let mut parts = start.split(' ');
    let method = parts.next().ok_or(HttpFail::Bad)?.to_string();
    let raw_path = parts.next().ok_or(HttpFail::Bad)?;
    let version = parts.next().ok_or(HttpFail::Bad)?;
    if parts.next().is_some() || !version.starts_with("HTTP/") || method.is_empty() {
        return Err(HttpFail::Bad);
    }
    let path = raw_path.split('?').next().unwrap_or("").to_string();
    if path.is_empty() {
        return Err(HttpFail::Bad);
    }
    let mut content_length = None;
    let mut transfer_encoding = false;
    let mut seen_length = false;
    for line in rest.split("\r\n") {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err(HttpFail::Bad);
        };
        if name.eq_ignore_ascii_case("content-length") {
            if seen_length {
                return Err(HttpFail::Bad);
            }
            seen_length = true;
            content_length = Some(value.trim().parse::<u64>().map_err(|_| HttpFail::Bad)?);
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            transfer_encoding = true;
        }
    }
    Ok(Head { method, path, content_length, transfer_encoding })
}

pub(crate) fn response_status(method: &str, path: &str) -> u16 {
    if method == "POST" && (path == "/pair" || path == "/sync") {
        200
    } else {
        404
    }
}

fn http(status: u16, reason: &str, body: &[u8], json: bool) -> Vec<u8> {
    let content_type = if json { "Content-Type: application/json\r\n" } else { "" };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n{content_type}\r\n",
        body.len()
    );
    let mut out = head.into_bytes();
    out.extend_from_slice(body);
    out
}

fn http_empty(status: u16) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
        410 => "Gone",
        503 => "Service Unavailable",
        _ => "Error",
    };
    http(status, reason, &[], false)
}

pub(crate) fn seal(key: &[u8; 32], nonce: &[u8; 12], plain: &[u8]) -> Result<Vec<u8>, ()> {
    let cipher = ChaCha20Poly1305::new(chacha20poly1305::Key::from_slice(key));
    cipher
        .encrypt(Nonce::from_slice(nonce), Payload { msg: plain, aad: AAD })
        .map_err(|_| ())
}

pub(crate) fn open_box(key: &[u8; 32], nonce: &[u8; 12], cipher_and_tag: &[u8]) -> Result<Vec<u8>, ()> {
    let cipher = ChaCha20Poly1305::new(chacha20poly1305::Key::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce), Payload { msg: cipher_and_tag, aad: AAD })
        .map_err(|_| ())
}

pub(crate) fn open_sync_key(bytes: Option<&[u8]>) -> Result<[u8; 32], u16> {
    let Some(bytes) = bytes else {
        return Err(401);
    };
    <[u8; 32]>::try_from(bytes).map_err(|_| 401)
}

fn decrypt_request(key: &[u8; 32], body: &[u8]) -> Result<Vec<u8>, ()> {
    let value: Value = serde_json::from_slice(body).map_err(|_| ())?;
    if value.get("v").and_then(|item| item.as_u64()) != Some(1) {
        return Err(());
    }
    let nonce = STANDARD
        .decode(value.get("n").and_then(|item| item.as_str()).ok_or(())?)
        .map_err(|_| ())?;
    let cipher = STANDARD
        .decode(value.get("c").and_then(|item| item.as_str()).ok_or(())?)
        .map_err(|_| ())?;
    let nonce: [u8; 12] = nonce.try_into().map_err(|_| ())?;
    open_box(key, &nonce, &cipher)
}

fn encrypt_reply(key: &[u8; 32], plain: &str) -> Result<Vec<u8>, ()> {
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let cipher = seal(key, &nonce, plain.as_bytes())?;
    serde_json::to_vec(&json!({
        "v": 1,
        "n": STANDARD.encode(nonce),
        "c": STANDARD.encode(cipher),
    }))
    .map_err(|_| ())
}

fn parse_pair_body(body: &[u8]) -> Option<(String, String)> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let secret = value.get("secret").and_then(|item| item.as_str())?.to_string();
    let name = pair_name(value.get("name").and_then(|item| item.as_str()).unwrap_or(""));
    Some((secret, name))
}

fn pair_name(raw: &str) -> String {
    let trimmed = raw.trim();
    let count = trimmed.chars().count();
    if (1..=40).contains(&count) {
        trimmed.to_string()
    } else {
        "Phone".to_string()
    }
}

fn random_secret() -> String {
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| {
            let index = rng.gen_range(0..SECRET_ALPHABET.len());
            SECRET_ALPHABET[index] as char
        })
        .collect()
}

fn pairing_code(host: &str, port: u16, secret: &str) -> String {
    format!("layp:1:{host}:{port}:{secret}")
}

fn expiry_from_now() -> (SystemTime, String) {
    let when = SystemTime::now() + OFFER_TTL;
    let millis = when.duration_since(UNIX_EPOCH).map(|duration| duration.as_millis() as u64).unwrap_or(0);
    (when, crate::db_tx::iso_from_unix_millis(millis))
}

pub(crate) fn reject_mint(key_exists: bool, replace: bool) -> Result<(), &'static str> {
    if key_exists && !replace {
        Err("A phone is already paired.")
    } else {
        Ok(())
    }
}

fn key_file(dir: &Path) -> PathBuf {
    dir.join(KEY_FILE)
}

fn write_key(dir: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let path = key_file(dir);
    std::fs::write(&path, bytes)?;
    let mut permissions = std::fs::metadata(&path)?.permissions();
    permissions.set_mode(0o600);
    std::fs::set_permissions(&path, permissions)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn cursor_value(value: &Value, key: &str) -> Value {
    let Some(cursor) = value.get(key) else {
        return json!({ "at": "", "id": "" });
    };
    match (cursor.get("at").and_then(|item| item.as_str()), cursor.get("id").and_then(|item| item.as_str())) {
        (Some(at), Some(id)) => json!({ "at": at, "id": id }),
        _ => json!({ "at": "", "id": "" }),
    }
}

fn array_value(value: &Value, key: &str) -> Value {
    value.get(key).filter(|item| item.is_array()).cloned().unwrap_or_else(|| json!([]))
}

#[tauri::command]
pub async fn phone_set_enabled(app: AppHandle, link: State<'_, PhoneLink>, on: bool) -> Result<PhoneBind, String> {
    link.set_enabled(&app, on).await
}

#[tauri::command]
pub fn phone_status(app: AppHandle, link: State<'_, PhoneLink>) -> Result<PhoneStatus, String> {
    let dir = crate::config_dir(&app)?;
    Ok(link.status(&dir))
}

#[tauri::command]
pub fn phone_pairing_offer(app: AppHandle, link: State<'_, PhoneLink>, replace: bool) -> Result<PairingOffer, String> {
    let dir = crate::config_dir(&app)?;
    link.mint(&dir, replace)
}

#[tauri::command]
pub fn phone_forget(app: AppHandle, link: State<'_, PhoneLink>) -> Result<(), String> {
    let dir = crate::config_dir(&app)?;
    let path = key_file(&dir);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|err| err.to_string())?;
    }
    link.clear_offer();
    app.emit("phone-forget", json!({})).map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn phone_kick(link: State<'_, PhoneLink>) -> Result<(), String> {
    link.kick();
    Ok(())
}

#[tauri::command]
pub fn phone_reply(link: State<'_, PhoneLink>, id: String, body: Option<String>) -> Result<(), String> {
    link.take_reply(&id, body);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[test]
    fn private_peers_match_the_lan_ranges() {
        assert!(is_private_peer("192.168.1.5".parse().unwrap()));
        assert!(is_private_peer("10.1.2.3".parse().unwrap()));
        assert!(is_private_peer("172.16.0.1".parse().unwrap()));
        assert!(is_private_peer("172.31.255.255".parse().unwrap()));
        assert!(is_private_peer("169.254.1.1".parse().unwrap()));
        assert!(is_private_peer("fe80::1".parse().unwrap()));
        assert!(is_private_peer("fc00::1".parse().unwrap()));
        assert!(is_private_peer("fd12:3456::1".parse().unwrap()));
        assert!(!is_private_peer("8.8.8.8".parse().unwrap()));
        assert!(!is_private_peer("127.0.0.1".parse().unwrap()));
        assert!(!is_private_peer("100.64.0.1".parse().unwrap()));
        assert!(!is_private_peer("172.32.0.1".parse().unwrap()));
        assert!(!is_private_peer("2001:db8::1".parse().unwrap()));
    }

    #[test]
    fn route_fixture_picks_the_lowest_metric_and_skips_unspecified() {
        let table = "\
Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT
eth0 00000000 0101A8C0 0003 0 0 600 00000000 0 0 0
wlan0 00000000 0100A8C0 0003 0 0 100 00000000 0 0 0
eth0 0001A8C0 00000000 0001 0 0 0 00FFFFFF 0 0 0
";
        assert_eq!(default_route_iface(table).as_deref(), Some("wlan0"));
        let addresses = vec![
            Ipv4OnIface { name: "wlan0".to_string(), addr: Ipv4Addr::new(0, 0, 0, 0) },
            Ipv4OnIface { name: "wlan0".to_string(), addr: Ipv4Addr::new(192, 168, 1, 20) },
            Ipv4OnIface { name: "eth0".to_string(), addr: Ipv4Addr::new(10, 0, 0, 2) },
            Ipv4OnIface { name: "lo".to_string(), addr: Ipv4Addr::new(127, 0, 0, 1) },
        ];
        assert_eq!(pick_host("wlan0", &addresses), Some(Ipv4Addr::new(192, 168, 1, 20)));
        assert_eq!(other_ipv4("wlan0", Ipv4Addr::new(192, 168, 1, 20), &addresses), vec!["10.0.0.2".to_string()]);
    }

    async fn exchange(bytes: &[u8]) -> Result<HttpRequest, HttpFail> {
        let (mut client, mut server) = tokio::io::duplex(64 * 1024);
        let owned = bytes.to_vec();
        let write = tokio::spawn(async move {
            let _ = client.write_all(&owned).await;
        });
        let result = read_http(&mut server).await;
        let _ = write.await;
        result
    }

    #[tokio::test]
    async fn http_reader_accepts_a_post_and_rejects_the_listed_failures() {
        let ok = exchange(b"POST /pair HTTP/1.1\r\nHost: 192.168.1.20\r\nContent-Length: 2\r\n\r\n{}")
            .await
            .unwrap();
        assert_eq!(ok.method, "POST");
        assert_eq!(ok.path, "/pair");
        assert_eq!(ok.body, b"{}");
        assert_eq!(response_status(&ok.method, &ok.path), 200);

        let missing = exchange(b"POST /pair HTTP/1.1\r\nHost: x\r\n\r\n").await.unwrap_err();
        assert_eq!(missing, HttpFail::Bad);

        let mut huge = b"POST /pair HTTP/1.1\r\nX: ".to_vec();
        huge.resize(9000, b'a');
        huge.extend_from_slice(b"\r\n\r\n");
        assert_eq!(exchange(&huge).await.unwrap_err(), HttpFail::TooLarge);

        let over = format!("POST /sync HTTP/1.1\r\nContent-Length: {}\r\n\r\n", BODY_CAP + 1);
        assert_eq!(exchange(over.as_bytes()).await.unwrap_err(), HttpFail::TooLarge);

        let get = exchange(b"GET /pair HTTP/1.1\r\nContent-Length: 0\r\n\r\n").await.unwrap();
        assert_eq!(response_status(&get.method, &get.path), 404);

        let bad = exchange(b"POST /files HTTP/1.1\r\nContent-Length: 0\r\n\r\n").await.unwrap();
        assert_eq!(response_status(&bad.method, &bad.path), 404);
    }

    #[tokio::test(start_paused = true)]
    async fn header_read_past_five_seconds() {
        let (client, mut server) = tokio::io::duplex(64);
        let task = tokio::spawn(async move { read_http(&mut server).await });
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(5)).await;
        tokio::task::yield_now().await;
        assert_eq!(task.await.unwrap().unwrap_err(), HttpFail::Timeout);
        drop(client);
    }

    #[test]
    fn seal_round_trip_and_a_flipped_byte_fails() {
        let key = [7u8; 32];
        let nonce = [9u8; 12];
        let plain = br#"{"phoneId":"phone"}"#;
        let mut cipher = seal(&key, &nonce, plain).unwrap();
        assert_eq!(open_box(&key, &nonce, &cipher).unwrap(), plain);
        cipher[0] ^= 0x01;
        assert!(open_box(&key, &nonce, &cipher).is_err());
    }

    #[test]
    fn missing_key_is_401_without_a_sqlite_read() {
        assert_eq!(open_sync_key(None), Err(401));
    }

    #[test]
    fn offer_expires_once_and_the_eighth_guess_burns_it() {
        let expires = SystemTime::now() + Duration::from_secs(60);
        let mut offer = Offer::fresh("ABCDEFGH".to_string(), expires, "later".to_string());
        assert_eq!(offer.judge("ABCDEFGH", SystemTime::now()), 200);
        offer.used = true;
        assert_eq!(offer.judge("ABCDEFGH", SystemTime::now()), 410);
        assert_eq!(offer.judge("OTHERKEY", SystemTime::now()), 401);

        let mut burned = Offer::fresh("ABCDEFGH".to_string(), expires, "later".to_string());
        for _ in 0..7 {
            assert_eq!(burned.judge("WRONGONE", SystemTime::now()), 401);
            assert!(!burned.burned);
        }
        assert_eq!(burned.judge("WRONGONE", SystemTime::now()), 401);
        assert!(burned.burned);
        assert_eq!(burned.judge("ABCDEFGH", SystemTime::now()), 401);

        let past = SystemTime::now() - Duration::from_secs(1);
        let mut expired = Offer::fresh("ABCDEFGH".to_string(), past, "earlier".to_string());
        assert_eq!(expired.judge("ABCDEFGH", SystemTime::now()), 401);
    }

    #[test]
    fn replace_false_while_the_key_exists_does_not_mint() {
        let mut offer: Option<Offer> = None;
        assert!(reject_mint(true, false).is_err());
        assert!(offer.is_none());
        assert!(reject_mint(true, true).is_ok());
        assert!(reject_mint(false, false).is_ok());
        offer = Some(Offer::fresh("NEWCODE1".to_string(), SystemTime::now(), "iso".to_string()));
        assert_eq!(offer.as_ref().unwrap().secret, "NEWCODE1");
    }
}
