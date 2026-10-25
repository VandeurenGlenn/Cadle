// Browser builds use the platform WebRTC implementation. This module also
// guards against @vandeurenglenn/wrtc releases whose browser export is absent.
const runtime = globalThis as typeof globalThis & Record<string, unknown>

export const MediaStream = runtime.MediaStream
export const MediaStreamTrack = runtime.MediaStreamTrack
export const RTCDataChannel = runtime.RTCDataChannel
export const RTCDataChannelEvent = runtime.RTCDataChannelEvent
export const RTCDtlsTransport = runtime.RTCDtlsTransport
export const RTCIceCandidate = runtime.RTCIceCandidate
export const RTCIceTransport = runtime.RTCIceTransport
export const RTCPeerConnection = runtime.RTCPeerConnection
export const RTCPeerConnectionIceEvent = runtime.RTCPeerConnectionIceEvent
export const RTCRtpReceiver = runtime.RTCRtpReceiver
export const RTCRtpSender = runtime.RTCRtpSender
export const RTCRtpTransceiver = runtime.RTCRtpTransceiver
export const RTCSctpTransport = runtime.RTCSctpTransport
export const RTCSessionDescription = runtime.RTCSessionDescription
export const mediaDevices = runtime.navigator && 'mediaDevices' in runtime.navigator
  ? runtime.navigator.mediaDevices
  : undefined
export const getUserMedia = mediaDevices && typeof mediaDevices.getUserMedia === 'function'
  ? mediaDevices.getUserMedia.bind(mediaDevices)
  : undefined

export default {
  MediaStream,
  MediaStreamTrack,
  RTCDataChannel,
  RTCDataChannelEvent,
  RTCDtlsTransport,
  RTCIceCandidate,
  RTCIceTransport,
  RTCPeerConnection,
  RTCPeerConnectionIceEvent,
  RTCRtpReceiver,
  RTCRtpSender,
  RTCRtpTransceiver,
  RTCSctpTransport,
  RTCSessionDescription,
  getUserMedia,
  mediaDevices
}
