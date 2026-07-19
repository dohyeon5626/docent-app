const { execFileSync } = require('child_process')
const path = require('path')

// Electron's stock Info.plist ships boilerplate usage-description placeholders
// for capabilities the app never actually uses. Docent never touches the
// camera, microphone, Bluetooth, or audio capture, so strip these out —
// otherwise a curious user (or macOS itself) can surface a permission prompt
// that makes no sense for a PDF study app.
const UNUSED_USAGE_DESCRIPTION_KEYS = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSAudioCaptureUsageDescription'
]

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const plistPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Info.plist'
  )

  for (const key of UNUSED_USAGE_DESCRIPTION_KEYS) {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plistPath])
      console.log(`afterPack: removed ${key} from Info.plist`)
    } catch {
      // key wasn't present — nothing to do
    }
  }
}
