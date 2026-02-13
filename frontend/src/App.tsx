import { useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useGameStore } from './store/gameStore'
import HomePage from './pages/HomePage'
import RoomPage from './pages/RoomPage'
import './App.css'

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const { resumeToken, restoreConnection, socket } = useGameStore()

  useEffect(() => {
    // Try to restore connection on mount if we have a token
    if (resumeToken && location.pathname === '/') {
      restoreConnection()
    }
  }, [])

  useEffect(() => {
    // Listen for room joined event to navigate
    if (socket) {
      socket.on('room:joined', ({ roomId }: { roomId: string }) => {
        navigate(`/room/${roomId}`)
      })

      return () => {
        socket.off('room:joined')
      }
    }
  }, [socket, navigate])

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>
    </div>
  )
}

export default App
