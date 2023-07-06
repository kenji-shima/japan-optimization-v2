import 'mapbox-gl/dist/mapbox-gl.css';
import mapboxgl from 'mapbox-gl'

mapboxgl.accessToken = "***REMOVED***";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v9",
  center: [0, 0],
  zoom: 1,
});

map.on("load", () => {
  console.log("Map is ready");  
});