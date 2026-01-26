import './AtomLoader.css'

export default function AtomLoader() {
  return (
    <div className="atom-loader-container">
      <div className="atom-loader">
        {/* 궤도 1 */}
        <div className="orbit orbit-1">
          <div className="electron electron-1"></div>
        </div>
        
        {/* 궤도 2 */}
        <div className="orbit orbit-2">
          <div className="electron electron-2"></div>
        </div>
        
        {/* 궤도 3 */}
        <div className="orbit orbit-3">
          <div className="electron electron-3"></div>
        </div>
        
        {/* 궤도 4 */}
        <div className="orbit orbit-4">
          <div className="electron electron-4"></div>
        </div>
        
        {/* 궤도 5 */}
        <div className="orbit orbit-5">
          <div className="electron electron-5"></div>
        </div>
      </div>
    </div>
  )
}
