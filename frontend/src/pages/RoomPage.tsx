import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import './RoomPage.css';

const PHASE_TEXT: Record<string, string> = {
  LOBBY: '等待开始',
  DEAL: '发词中',
  SPEAKING: '发言阶段',
  VOTING: '投票阶段',
  RESOLVE: '结算阶段',
  END: '游戏结束'
};

const VOICE_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

interface VoiceOfferPayload {
  fromSeat: number;
  sdp: RTCSessionDescriptionInit;
}

interface VoiceAnswerPayload {
  fromSeat: number;
  sdp: RTCSessionDescriptionInit;
}

interface VoiceIcePayload {
  fromSeat: number;
  candidate: RTCIceCandidateInit;
}

function RoomPage() {
  const { roomId: roomIdParam = '' } = useParams();
  const navigate = useNavigate();
  const [speechInput, setSpeechInput] = useState('');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [targetCountDraft, setTargetCountDraft] = useState(4);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceInterimText, setVoiceInterimText] = useState('');
  const [voiceInputHint, setVoiceInputHint] = useState('点击按钮可将语音转换为文字');
  const [voiceInputError, setVoiceInputError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const myTurnRef = useRef(false);
  const [voiceMicReady, setVoiceMicReady] = useState(false);
  const [voiceCanSpeak, setVoiceCanSpeak] = useState(false);
  const [voiceRoomError, setVoiceRoomError] = useState<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const remoteAudioRef = useRef<Map<number, HTMLAudioElement>>(new Map());
  const offeredPeersRef = useRef<Set<number>>(new Set());

  const {
    connected,
    socket,
    error,
    clearError,
    nickname,
    setNickname,
    roomState,
    voteResult,
    gameEnd,
    joinRoom,
    leaveRoom,
    startGame,
    restartGame,
    setTargetPlayerCount,
    setRoomLocked,
    speak,
    vote
  } = useGameStore();

  const roomId = roomIdParam.toUpperCase();
  const inCurrentRoom = roomState?.roomId === roomId;

  const voteCycleKey = `${roomState?.round ?? 0}-${roomState?.phase ?? 'NONE'}-${
    roomState?.tieBreakCandidates.join(',') ?? ''
  }`;

  useEffect(() => {
    setHasVoted(false);
  }, [voteCycleKey]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = setTimeout(() => clearError(), 4000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  useEffect(() => {
    const deadline = roomState?.deadlineTs;
    if (!deadline) {
      setTimeLeft(null);
      return;
    }

    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(seconds);
    };

    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [roomState?.deadlineTs]);

  useEffect(() => {
    if (!roomState) {
      return;
    }
    setTargetCountDraft(roomState.targetPlayerCount);
  }, [roomState?.targetPlayerCount]);

  const appendSpeechTranscript = useCallback((fragment: string) => {
    const normalized = fragment.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      return;
    }

    setSpeechInput((previous) => `${previous} ${normalized}`.trim().replace(/\s+/g, ' ').slice(0, 30));
  }, []);

  const mapRecognitionError = useCallback((errorCode: string): string => {
    switch (errorCode) {
      case 'not-allowed':
      case 'service-not-allowed':
        return '语音输入权限被拒绝，请在浏览器中开启麦克风权限';
      case 'audio-capture':
        return '未检测到可用麦克风，请检查设备连接';
      case 'network':
        return '语音识别网络异常，请稍后重试';
      case 'no-speech':
        return '没有识别到语音，已继续监听';
      case 'aborted':
        return '语音输入已停止';
      default:
        return '语音识别失败，请重试';
    }
  }, []);

  const clearVoiceResources = useCallback(() => {
    for (const connection of peerConnectionsRef.current.values()) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.onconnectionstatechange = null;
      connection.close();
    }
    peerConnectionsRef.current.clear();
    offeredPeersRef.current.clear();

    for (const audio of remoteAudioRef.current.values()) {
      audio.srcObject = null;
      audio.remove();
    }
    remoteAudioRef.current.clear();

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }

    setVoiceMicReady(false);
    setVoiceCanSpeak(false);
  }, []);

  useEffect(() => {
    if (!inCurrentRoom || !roomState?.isVoiceRoom || !socket) {
      clearVoiceResources();
      setVoiceRoomError(null);
      return;
    }

    let cancelled = false;

    const getOrCreateAudio = (seat: number): HTMLAudioElement => {
      const existing = remoteAudioRef.current.get(seat);
      if (existing) {
        return existing;
      }
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      audio.dataset.seat = String(seat);
      remoteAudioRef.current.set(seat, audio);
      return audio;
    };

    const removeAudio = (seat: number): void => {
      const audio = remoteAudioRef.current.get(seat);
      if (!audio) {
        return;
      }
      audio.srcObject = null;
      audio.remove();
      remoteAudioRef.current.delete(seat);
    };

    const getOrCreatePeerConnection = (remoteSeat: number): RTCPeerConnection | null => {
      const cached = peerConnectionsRef.current.get(remoteSeat);
      if (cached) {
        return cached;
      }

      if (!localStreamRef.current || roomState.mySeat === undefined) {
        return null;
      }

      const mySeat = roomState.mySeat;
      const connection = new RTCPeerConnection({ iceServers: VOICE_ICE_SERVERS });

      for (const track of localStreamRef.current.getTracks()) {
        connection.addTrack(track, localStreamRef.current);
      }

      connection.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        socket.emit('voice:ice', {
          toSeat: remoteSeat,
          candidate: event.candidate.toJSON()
        });
      };

      connection.ontrack = (event) => {
        const audio = getOrCreateAudio(remoteSeat);
        const [stream] = event.streams;
        if (stream) {
          audio.srcObject = stream;
        }
      };

      connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
          connection.close();
          peerConnectionsRef.current.delete(remoteSeat);
          offeredPeersRef.current.delete(remoteSeat);
          removeAudio(remoteSeat);
        }
      };

      peerConnectionsRef.current.set(remoteSeat, connection);

      if (mySeat < remoteSeat && !offeredPeersRef.current.has(remoteSeat)) {
        offeredPeersRef.current.add(remoteSeat);
        void (async () => {
          try {
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            socket.emit('voice:offer', { toSeat: remoteSeat, sdp: offer });
          } catch {
            offeredPeersRef.current.delete(remoteSeat);
          }
        })();
      }

      return connection;
    };

    const setupLocalStream = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setVoiceRoomError('当前浏览器不支持语音房');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }

        localStreamRef.current = stream;
        for (const track of stream.getAudioTracks()) {
          track.enabled = false;
        }
        setVoiceMicReady(true);
        setVoiceRoomError(null);
      } catch {
        if (!cancelled) {
          setVoiceMicReady(false);
          setVoiceRoomError('麦克风不可用，请检查浏览器授权');
        }
      }
    };

    const onVoiceOffer = (payload: VoiceOfferPayload) => {
      void (async () => {
        const connection = getOrCreatePeerConnection(payload.fromSeat);
        if (!connection) {
          return;
        }
        try {
          await connection.setRemoteDescription(payload.sdp);
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          socket.emit('voice:answer', { toSeat: payload.fromSeat, sdp: answer });
        } catch {
          // ignore broken negotiation
        }
      })();
    };

    const onVoiceAnswer = (payload: VoiceAnswerPayload) => {
      const connection = peerConnectionsRef.current.get(payload.fromSeat);
      if (!connection) {
        return;
      }
      void connection.setRemoteDescription(payload.sdp).catch(() => {
        // ignore invalid SDP
      });
    };

    const onVoiceIce = (payload: VoiceIcePayload) => {
      const connection = peerConnectionsRef.current.get(payload.fromSeat);
      if (!connection || !payload.candidate) {
        return;
      }
      void connection.addIceCandidate(payload.candidate).catch(() => {
        // ignore broken candidate
      });
    };

    socket.on('voice:offer', onVoiceOffer);
    socket.on('voice:answer', onVoiceAnswer);
    socket.on('voice:ice', onVoiceIce);
    void setupLocalStream();

    return () => {
      cancelled = true;
      socket.off('voice:offer', onVoiceOffer);
      socket.off('voice:answer', onVoiceAnswer);
      socket.off('voice:ice', onVoiceIce);
      clearVoiceResources();
    };
  }, [clearVoiceResources, inCurrentRoom, roomState?.isVoiceRoom, roomState?.mySeat, socket]);

  useEffect(() => {
    if (!inCurrentRoom || !roomState?.isVoiceRoom || roomState.mySeat === undefined || !socket) {
      return;
    }

    const mySeat = roomState.mySeat;
    const remoteSeats = new Set(
      roomState.players
        .filter((player) => !player.isAI && player.connected && player.seat !== mySeat)
        .map((player) => player.seat)
    );

    for (const remoteSeat of remoteSeats) {
      if (peerConnectionsRef.current.has(remoteSeat)) {
        continue;
      }

      if (!localStreamRef.current) {
        continue;
      }

      const connection = new RTCPeerConnection({ iceServers: VOICE_ICE_SERVERS });
      for (const track of localStreamRef.current.getTracks()) {
        connection.addTrack(track, localStreamRef.current);
      }

      connection.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        socket.emit('voice:ice', {
          toSeat: remoteSeat,
          candidate: event.candidate.toJSON()
        });
      };

      connection.ontrack = (event) => {
        const existing = remoteAudioRef.current.get(remoteSeat);
        const audio = existing ?? document.createElement('audio');
        audio.autoplay = true;
        audio.setAttribute('playsinline', 'true');
        audio.dataset.seat = String(remoteSeat);
        const [stream] = event.streams;
        if (stream) {
          audio.srcObject = stream;
        }
        remoteAudioRef.current.set(remoteSeat, audio);
      };

      connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
          connection.close();
          peerConnectionsRef.current.delete(remoteSeat);
          offeredPeersRef.current.delete(remoteSeat);
          const audio = remoteAudioRef.current.get(remoteSeat);
          if (audio) {
            audio.srcObject = null;
            audio.remove();
          }
          remoteAudioRef.current.delete(remoteSeat);
        }
      };

      peerConnectionsRef.current.set(remoteSeat, connection);

      if (mySeat < remoteSeat && !offeredPeersRef.current.has(remoteSeat)) {
        offeredPeersRef.current.add(remoteSeat);
        void (async () => {
          try {
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            socket.emit('voice:offer', { toSeat: remoteSeat, sdp: offer });
          } catch {
            offeredPeersRef.current.delete(remoteSeat);
          }
        })();
      }
    }

    for (const [seat, connection] of peerConnectionsRef.current.entries()) {
      if (remoteSeats.has(seat)) {
        continue;
      }
      connection.close();
      peerConnectionsRef.current.delete(seat);
      offeredPeersRef.current.delete(seat);
      const audio = remoteAudioRef.current.get(seat);
      if (audio) {
        audio.srcObject = null;
        audio.remove();
      }
      remoteAudioRef.current.delete(seat);
    }

    const me = roomState.players.find((player) => player.seat === mySeat);
    const canSpeakNow = roomState.phase === 'SPEAKING' && roomState.currentSpeaker === mySeat && Boolean(me?.isAlive);
    setVoiceCanSpeak(canSpeakNow);

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getAudioTracks()) {
        track.enabled = canSpeakNow;
      }
    }
  }, [inCurrentRoom, roomState, socket]);

  useEffect(() => {
    const RecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      setVoiceSupported(false);
      setVoiceInputHint('当前浏览器不支持语音输入');
      return;
    }

    const recognition = new RecognitionCtor();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.onstart = () => {
      setVoiceInputError(null);
      setVoiceInputHint('正在听写，请说话...');
      setIsListening(true);
    };
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim();
        if (!transcript) {
          continue;
        }

        if (result.isFinal) {
          finalTranscript += ` ${transcript}`;
        } else {
          interimTranscript += ` ${transcript}`;
        }
      }

      if (finalTranscript.trim()) {
        appendSpeechTranscript(finalTranscript);
      }

      const interim = interimTranscript.trim().replace(/\s+/g, ' ');
      setVoiceInterimText(interim);
      if (interim) {
        setVoiceInputHint(`识别中：${interim.slice(0, 24)}`);
      } else {
        setVoiceInputHint('正在听写，请说话...');
      }
    };
    recognition.onend = () => {
      setIsListening(false);
      setVoiceInterimText('');

      if (!shouldKeepListeningRef.current || !myTurnRef.current) {
        setVoiceInputHint('点击按钮可将语音转换为文字');
        return;
      }

      window.setTimeout(() => {
        if (!shouldKeepListeningRef.current || !myTurnRef.current) {
          return;
        }

        try {
          recognition.start();
        } catch {
          setVoiceInputHint('语音输入重启失败，请手动重试');
          setVoiceInputError('语音输入重启失败，请手动重试');
          shouldKeepListeningRef.current = false;
          setIsListening(false);
        }
      }, 180);
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsListening(false);
      setVoiceInterimText('');

      const errorMessage = mapRecognitionError(event.error);
      setVoiceInputHint(errorMessage);

      if (event.error !== 'no-speech') {
        setVoiceInputError(errorMessage);
      }

      if (event.error !== 'no-speech') {
        shouldKeepListeningRef.current = false;
      }
    };

    recognitionRef.current = recognition;
    setVoiceSupported(true);

    return () => {
      shouldKeepListeningRef.current = false;
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.abort();
      recognitionRef.current = null;
      setVoiceInterimText('');
      setIsListening(false);
    };
  }, [appendSpeechTranscript, mapRecognitionError]);

  useEffect(() => {
    const me = roomState?.players.find((player) => player.seat === roomState.mySeat);
    const myTurnNow =
      roomState?.phase === 'SPEAKING' && roomState.currentSpeaker === roomState.mySeat && Boolean(me?.isAlive);

    myTurnRef.current = Boolean(myTurnNow);

    if (!myTurnNow && (isListening || shouldKeepListeningRef.current)) {
      shouldKeepListeningRef.current = false;
      recognitionRef.current?.stop();
      setVoiceInterimText('');
      setVoiceInputHint('点击按钮可将语音转换为文字');
      setIsListening(false);
    }
  }, [roomState, isListening]);

  const alivePlayers = useMemo(() => {
    return roomState?.players.filter((player) => player.isAlive) ?? [];
  }, [roomState?.players]);

  const voteTargets = useMemo(() => {
    if (!roomState) {
      return [];
    }
    if (roomState.tieBreakCandidates.length === 0) {
      return alivePlayers;
    }
    return alivePlayers.filter((player) => roomState.tieBreakCandidates.includes(player.seat));
  }, [alivePlayers, roomState]);

  if (!roomId) {
    return (
      <div className="room-page">
        <div className="waiting-message">房间号无效</div>
      </div>
    );
  }

  if (!inCurrentRoom) {
    return (
      <div className="room-page">
        <div className="room-header">
          <h1>加入房间</h1>
          <div className="room-id">{roomId}</div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="action-section">
          <h3>通过邀请链接加入</h3>
          <p className="join-hint">请输入昵称后即可进入房间。</p>
          <input
            className="speak-input"
            placeholder="输入昵称（最多12字）"
            maxLength={12}
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
          />
          <button
            className="btn-primary"
            disabled={!connected || !nickname.trim()}
            onClick={() => joinRoom(roomId, nickname)}
          >
            立即加入
          </button>
          <button className="leave-btn leave-btn-full" onClick={() => navigate('/')}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const mySeat = roomState.mySeat;
  const myPlayer = roomState.players.find((player) => player.seat === mySeat);
  const myAlive = Boolean(myPlayer?.isAlive);
  const myTurn = roomState.phase === 'SPEAKING' && roomState.currentSpeaker === mySeat && myAlive;
  const votingNow = roomState.phase === 'VOTING' && myAlive;
  const allSeats = Array.from({ length: roomState.targetPlayerCount }, (_, index) => index + 1);
  const humanCount = roomState.players.filter((player) => !player.isAI).length;
  const voiceRoomCanStart = !roomState.isVoiceRoom || humanCount === roomState.targetPlayerCount;

  const handleLeave = () => {
    leaveRoom();
    navigate('/');
  };

  const toggleRoomLock = () => {
    setRoomLocked(!roomState.isLocked);
  };

  const toggleVoiceInput = () => {
    if (!voiceSupported || !recognitionRef.current) {
      return;
    }

    if (isListening || shouldKeepListeningRef.current) {
      shouldKeepListeningRef.current = false;
      recognitionRef.current.stop();
      setVoiceInterimText('');
      setVoiceInputHint('点击按钮可将语音转换为文字');
      setIsListening(false);
      return;
    }

    try {
      shouldKeepListeningRef.current = true;
      setVoiceInputError(null);
      setVoiceInterimText('');
      recognitionRef.current.start();
      setVoiceInputHint('正在听写，请说话...');
    } catch {
      shouldKeepListeningRef.current = false;
      setVoiceInputError('语音输入启动失败，请重试');
      setVoiceInputHint('语音输入启动失败，请重试');
      setIsListening(false);
    }
  };

  const inviteLink = `${window.location.origin}/#/room/${roomState.roomId}`;

  return (
    <div className="room-page">
      <div className="room-header">
        <h1>房间</h1>
        <div className="room-id">{roomState.roomId}</div>
        <button className="leave-btn" onClick={handleLeave}>
          离开
        </button>
      </div>

      {!connected && <div className="error-banner">连接已断开，正在自动重连...</div>}
      {error && <div className="error-banner">{error}</div>}

      <div className="game-info">
        <div>
          <span className={`phase-badge ${roomState.phase}`}>{PHASE_TEXT[roomState.phase] ?? roomState.phase}</span>
          {roomState.phase !== 'LOBBY' && roomState.phase !== 'END' && (
            <span className="round-label">第 {roomState.round} 轮</span>
          )}
        </div>
        {timeLeft !== null && roomState.phase !== 'END' && (
          <div className="countdown">剩余时间: {timeLeft} 秒</div>
        )}
        {roomState.phase === 'LOBBY' && (
          <div className="meta-line invite-line">
            邀请链接: {inviteLink}
          </div>
        )}
        <div className="meta-line">本房间目标人数: {roomState.targetPlayerCount}</div>
        <div className={`meta-line lock-state ${roomState.isLocked ? 'locked' : 'open'}`}>
          房间状态: {roomState.isLocked ? '已上锁（禁止新玩家加入）' : '开放中'}
        </div>
        {roomState.isVoiceRoom && (
          <>
            <div className="meta-line voice-room-tag">语音房模式：仅当前发言玩家可开麦，投票阶段全员静音</div>
            <div className="meta-line">麦克风状态：{voiceMicReady ? (voiceCanSpeak ? '可发言' : '静音中') : '未就绪'}</div>
            {voiceRoomError && <div className="meta-line voice-room-error">{voiceRoomError}</div>}
          </>
        )}
      </div>

      {roomState.phase !== 'LOBBY' && roomState.myWord && (
        <div className="my-info">
          <h3>我的线索信息</h3>
          <div className="role-info role-info-word">
            <div className="role-label">你的词</div>
            <div className="word-value">{roomState.myWord}</div>
          </div>
          {roomState.wordHint && <div className="meta-line">本局提示：{roomState.wordHint}</div>}
          <div className="meta-line">身份未知，请根据发言判断自己和他人的身份。</div>
        </div>
      )}

      {voteResult && (
        <div className="action-section action-section-tight">
          <h3>本轮投票结果</h3>
          <p className="vote-result-text">
            {voteResult.eliminatedSeat
              ? `淘汰座位 ${voteResult.eliminatedSeat}`
              : voteResult.tie
                ? '平票，进入下一轮发言'
                : '暂无淘汰'}
          </p>
        </div>
      )}

      {gameEnd && (
        <div className={`game-result ${gameEnd.winner}`}>
          <h2>{gameEnd.winner === 'civilian' ? '平民获胜！' : '卧底获胜！'}</h2>
          <div className="reveal-section">
            <h3>身份揭晓</h3>
            <div className="reveal-list">
              {gameEnd.reveal.rolesBySeat.map((item) => (
                <div key={item.seat} className="reveal-item">
                  座位{item.seat} {item.nickname}: {item.role === 'civilian' ? '平民' : '卧底'}
                  {!item.isAlive && ' (已淘汰)'}
                </div>
              ))}
            </div>
            <div className="words-reveal">
              <div className="word-box civilian">
                <h4>平民词</h4>
                <div className="word">{gameEnd.reveal.words.civilian}</div>
              </div>
              <div className="word-box undercover">
                <h4>卧底词</h4>
                <div className="word">{gameEnd.reveal.words.undercover}</div>
              </div>
            </div>
            {gameEnd.reveal.words.hint && <div className="meta-line">本局提示：{gameEnd.reveal.words.hint}</div>}
          </div>

          <div className="end-actions">
            {roomState.isHost ? (
              <>
                <div className="capacity-control">
                  <label htmlFor="targetCountEnd">下局人数</label>
                  <div className="capacity-row">
                    <input
                      id="targetCountEnd"
                      type="number"
                      min={4}
                      max={12}
                      value={targetCountDraft}
                      onChange={(event) => setTargetCountDraft(Number(event.target.value) || 4)}
                    />
                    <button className="btn-primary" onClick={() => setTargetPlayerCount(targetCountDraft)}>
                      保存人数
                    </button>
                  </div>
                </div>
                <button className="room-lock-btn" onClick={toggleRoomLock}>
                  {roomState.isLocked ? '开房（允许加入）' : '锁房（禁止加入）'}
                </button>
                <button className="start-btn" disabled={!voiceRoomCanStart} onClick={restartGame}>
                  再来一局
                </button>
              </>
            ) : (
              <div className="waiting-message waiting-message-gap">
                等待房主选择是否再来一局...
              </div>
            )}
            <button className="leave-btn end-leave-btn" onClick={handleLeave}>
              结束并离开
            </button>
          </div>
        </div>
      )}

      <div className="seats-grid">
        {allSeats.map((seat) => {
          const player = roomState.players.find((item) => item.seat === seat);
          if (!player) {
            return (
              <div key={seat} className="seat empty">
                <div className="seat-number">{seat}</div>
                <div className="nickname">空座位</div>
              </div>
            );
          }

          const current = roomState.currentSpeaker === seat;
          const me = roomState.mySeat === seat;
          return (
            <div
              key={seat}
              className={`seat ${me ? 'current-player' : ''} ${current ? 'current-speaker' : ''} ${
                !player.isAlive ? 'eliminated' : ''
              }`}
            >
              <div className="seat-number">{seat}</div>
              {player.isAI && <div className="ai-badge">AI</div>}
              {!player.isAI && !player.connected && player.isAlive && <div className="ai-badge">离线</div>}
              {!player.isAlive && <div className="dead-badge">已淘汰</div>}
              <div className="nickname">{player.nickname}</div>
              {me && <div className="me-tag">(你)</div>}
            </div>
          );
        })}
      </div>

      {roomState.phase === 'LOBBY' && roomState.isHost && (
        <div className="action-section">
          <h3>房间控制台</h3>
          <div className="capacity-control">
            <label htmlFor="targetCountLobby">目标人数（4-12）</label>
            <div className="capacity-row">
              <input
                id="targetCountLobby"
                type="number"
                min={4}
                max={12}
                value={targetCountDraft}
                onChange={(event) => setTargetCountDraft(Number(event.target.value) || 4)}
              />
              <button className="btn-primary" onClick={() => setTargetPlayerCount(targetCountDraft)}>
                保存人数
              </button>
            </div>
          </div>
          <button className="room-lock-btn" onClick={toggleRoomLock}>
            {roomState.isLocked ? '开房（允许加入）' : '锁房（禁止加入）'}
          </button>
          <button className="start-btn" disabled={!voiceRoomCanStart} onClick={startGame}>
            开始游戏（真人 {humanCount}/{roomState.targetPlayerCount}
            {roomState.isVoiceRoom ? '，语音房需满员' : ''}）
          </button>
          {roomState.isVoiceRoom && !voiceRoomCanStart && (
            <div className="voice-room-warn">语音房不能补 AI，请等待真人满员后开始。</div>
          )}
        </div>
      )}

      {roomState.phase === 'LOBBY' && !roomState.isHost && (
        <div className="waiting-message">
          {roomState.isLocked ? '房间已上锁，等待房主开始游戏...' : '等待房主开始游戏...'}
        </div>
      )}

      {myTurn && (
        <div className="action-section">
          <h3>轮到你发言</h3>
          <input
            className="speak-input"
            maxLength={30}
            placeholder="输入你的发言（30字以内）"
            value={speechInput}
            onChange={(event) => setSpeechInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && speechInput.trim()) {
                speak(speechInput);
                setSpeechInput('');
                if (isListening || shouldKeepListeningRef.current) {
                  shouldKeepListeningRef.current = false;
                  recognitionRef.current?.stop();
                  setVoiceInterimText('');
                  setVoiceInputHint('点击按钮可将语音转换为文字');
                }
              }
            }}
          />
          <div className="voice-controls">
            <button
              type="button"
              className={`voice-btn ${isListening ? 'recording' : ''}`}
              disabled={!voiceSupported}
              onClick={toggleVoiceInput}
            >
              {voiceSupported ? (isListening ? '停止语音输入' : '语音输入') : '当前浏览器不支持语音输入'}
            </button>
            {voiceSupported && (
              <div className="voice-hint">
                {voiceInputError
                  ? voiceInputError
                  : voiceInterimText
                    ? `实时识别：${voiceInterimText.slice(0, 24)}`
                    : voiceInputHint}
              </div>
            )}
          </div>
          <button
            className="btn-primary"
            disabled={!speechInput.trim()}
            onClick={() => {
              speak(speechInput);
              setSpeechInput('');
              if (isListening || shouldKeepListeningRef.current) {
                shouldKeepListeningRef.current = false;
                recognitionRef.current?.stop();
                setVoiceInterimText('');
                setVoiceInputHint('点击按钮可将语音转换为文字');
              }
            }}
          >
            提交发言
          </button>
        </div>
      )}

      {roomState.phase === 'SPEAKING' && !myTurn && <div className="waiting-message">等待当前玩家发言...</div>}

      {votingNow && !hasVoted && (
        <div className="action-section">
          <h3>{roomState.tieBreakCandidates.length ? '加赛投票' : '投票阶段'}</h3>
          <div className="voting-options">
            {voteTargets.map((player) => (
              <button
                key={player.seat}
                className={`vote-btn ${player.seat === mySeat ? 'self' : ''}`}
                disabled={player.seat === mySeat}
                onClick={() => {
                  vote(player.seat);
                  setHasVoted(true);
                }}
              >
                投给 {player.nickname}（座位{player.seat}）
              </button>
            ))}
            <button
              className="vote-btn abstain"
              onClick={() => {
                vote(0);
                setHasVoted(true);
              }}
            >
              弃权
            </button>
          </div>
        </div>
      )}

      {roomState.phase === 'VOTING' && (!myAlive || hasVoted) && (
        <div className="waiting-message">{myAlive ? '已投票，等待其他玩家...' : '你已淘汰，等待投票结果...'}</div>
      )}

      <div className="speeches-section">
        <h3>公共发言记录</h3>
        {roomState.speeches.length === 0 && <div className="no-speeches">暂无发言</div>}
        {roomState.speeches.map((speech, index) => (
          <div className="speech-item" key={`${speech.round}-${speech.seat}-${index}`}>
            <div className="speech-header">
              <span>
                第{speech.round}轮 座位{speech.seat}
              </span>
            </div>
            <div className="speech-text">{speech.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RoomPage;
