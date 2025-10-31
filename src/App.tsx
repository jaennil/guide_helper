import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

function App() {
  return (
    <div className="App">
      <h1>My Guide Helper App</h1>
      <MapContainer center={[55.7518, 37.6178]} zoom={15} style={{ height: '500px', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[55.7518, 37.6178]}>
          <Popup>Your starting point! <br /> Add routes here soon.</Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}

export default App;
