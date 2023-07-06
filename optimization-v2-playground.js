import { polyline } from "./polyline.js";

mapboxgl.accessToken = '***REMOVED***';
let lng = 139.62722;
let lat = 35.45305;

const optimization_v2 = 'https://api.mapbox.com/optimized-trips/v2'
const directions_uri = 'https://api.mapbox.com/directions/v5/mapbox/'
function uuidv4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}
async function fetchJson(file) {
    const query = await fetch(file, { method: 'GET' });
    return await query.json();
}
async function postJson(url, data) {
    const query = fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    })
    return (await query).json()
}

let map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/kenji-shima/clck4sxaf000414r7qc2h8by7',
    center: [lng, lat],
    zoom: 16,
    pitch: 40,
})

const geocoder = new MapboxGeocoder({
    // Initialize the geocoder
    accessToken: mapboxgl.accessToken, // Set the access token
    mapboxgl: mapboxgl, // Set the mapbox-gl instance
    marker: false // Do not use the default marker style
  });

map.on('load', () => {
    map.addControl(geocoder);
    appendVehicle()
    map.addSource('shipments-source', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: [],
        }
    })
    map.addLayer({
        id: 'shipments-layer',
        type: 'line',
        source: 'shipments-source',
        paint: {
            'line-color': 'black',
            'line-width': 15
        }
    })
    map.addLayer({
        id: 'arrows',
        type: 'symbol',
        source: 'shipments-source',
        layout: {
            'symbol-placement': 'line',
            'text-field': '>', // Use a Unicode arrow character as the text
            'text-size': 64,
            'text-rotation-alignment': 'map',
            'text-rotate': ['get', 'bearing'],
            'text-keep-upright': false
        },
        paint: {
            'text-color': '#000000',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 5
        }
    })
    map.on('click', 'shipments-layer', (e) => {
        if (!isInMode()) return
        const modal = document.getElementById('shipment-modal');
        const pixelPosition = map.project(e.lngLat);
        modal.style.top = pixelPosition.y + 'px';
        modal.style.left = pixelPosition.x + 'px';
        modal.style.display = 'block';

        const features = map.queryRenderedFeatures(e.point, { layers: ['shipments-layer'] });
        if (features.length > 0) {
            const clickedFeature = features[0]
            recoverShipment(clickedFeature)
        }
    })
})
let solution_request = {
    "version": 1,
    "locations": [],
    "vehicles": [],
    //"services" : [],
    "shipments": []
}

window.calculateSolution = () => {
    document.getElementsByClassName('mapboxgl-ctrl-geocoder--input')[0].disabled = true
    dispLoading()
    removeDirectionsLayers()
    solution_request.shipments = []
    solution_request.locations = []
    const shipmentFeatures = map.getSource('shipments-source')._data.features
    if (shipmentFeatures.length == 0) {
        removeLoading()
        alert('配送設定が不足してます。')
        return
    }
    const radio = document.getElementById('radio-two')
    radio.click()
    radio.disabled = true
    document.getElementById('radio-one').disabled = true
    let countUp = 0
    shipmentFeatures.forEach(feature => {
        const shipment = {
            //name: `${feature.properties.from}-${feature.properties.to}`,
            name: countUp + "",
            from: feature.properties.from,
            to: feature.properties.to,
        }
        countUp++
        if (feature.properties.pickup_starttime !== '' && feature.properties.pickup_endtime !== '') {
            const pickup_times = [
                {
                    earliest: getFullTime(feature.properties.pickup_starttime),
                    latest: getFullTime(feature.properties.pickup_endtime),
                    type: "strict"
                }
            ]
            shipment["pickup_times"] = pickup_times
        }
        if (feature.properties.dropoff_starttime !== '' && feature.properties.dropoff_endtime !== '') {
            const dropoff_times = [
                {
                    earliest: getFullTime(feature.properties.pickup_starttime),
                    latest: getFullTime(feature.properties.pickup_endtime),
                    type: "strict"
                }
            ]
            shipment["dropoff_times"] = dropoff_times
        }
        if (feature.properties.pickup_duration !== '') shipment['pickup_duration'] = feature.properties.pickup_duration
        if (feature.properties.dropoff_duration !== '') shipment['dropoff_duration'] = feature.properties.dropoff_duration
        if (feature.properties.item_count !== '') shipment['size'] = {boxes: parseInt(feature.properties.item_count)}
        if (feature.properties.requirements !== '') shipment['requirements'] = [feature.properties.requirements]

        solution_request.shipments.push(shipment)

        let isFromSet = false
        let isToSet = false
        solution_request.locations.forEach(location => {
            if (location.name === feature.properties.from) isFromSet = true
            if (location.name === feature.properties.to) isToSet = true
        })
        if (!isFromSet) solution_request.locations.push({ name: feature.properties.from, coordinates: feature.geometry.coordinates[0] })
        if (!isToSet) solution_request.locations.push({ name: feature.properties.to, coordinates: feature.geometry.coordinates[1] })
    })

    cleanSolutionRequest()
    postJson(`${optimization_v2}?access_token=${mapboxgl.accessToken}`, solution_request).then(json => {
        if (json.code === "validation_error") {
            removeLoading()
            alert(json.message)
            document.getElementById('radio-two').disabled = false
            document.getElementById('radio-one').disabled = false
            document.getElementsByClassName('mapboxgl-ctrl-geocoder--input')[0].disabled = false
            return
        }else{
            if (json.status === "ok") {
                processOptimization(json.id)
            }
        }
    })
}

function cleanSolutionRequest(){
    solution_request.shipments.forEach(shipment => {
        clearBlankProperties(shipment)
    })
    solution_request.vehicles.forEach(vehicle => {
        clearBlankProperties(vehicle)
    })
}

function clearBlankProperties(obj){
    for (let key in obj) {
        if (obj.hasOwnProperty(key) && obj[key] === '') {
          delete obj[key];
        }
      }
}

function processOptimization(id) {
    fetchJson(`${optimization_v2}/${id}?access_token=${mapboxgl.accessToken}`).then(json => {

        if (json.status === "processing") {
            setTimeout(() => {
                processOptimization(id)
            }, 200)
        } else {
            if (json.code === "validation_error") {
                removeLoading()
                alert(json.message)
                document.getElementById('radio-two').disabled = false
                document.getElementById('radio-one').disabled = false
                document.getElementsByClassName('mapboxgl-ctrl-geocoder--input')[0].disabled = false
                return
            }
            if (json.code === "unsolvable") {
                removeLoading()
                alert(json.message)
                document.getElementById('radio-two').disabled = false
                document.getElementById('radio-one').disabled = false
                document.getElementsByClassName('mapboxgl-ctrl-geocoder--input')[0].disabled = false
                return
            }
            json.routes.forEach(route => {
                makeDirectionsRequest(route)
            })

        }

    })
}

let directionsLayers = []
let directionsSources = []
function makeDirectionsRequest(route) {
    const stops = route.stops
    const color = getRandomColor()
    const uuid = uuidv4()
    let coordlist = ""
    for (let i in stops) {
        const metadata = stops[i].location_metadata
        if (coordlist !== "") {
            coordlist += ";"
        }
        coordlist += metadata.snapped_coordinate
    }
    fetchJson(`${directions_uri}driving/${coordlist}?access_token=${mapboxgl.accessToken}&geometries=polyline&overview=full&steps=true`).then(json => {
        if (map.getLayer('directions-layer')) map.removeLayer('directions-layer')
        if (map.getLayer('directions-arrows')) map.removeLayer('directions-arrows')
        if (map.getSource('directions-source')) map.removeSource('directions-source')

        map.addSource(`directions-source-${uuid}`, {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: polyline.toGeoJSON(json.routes[0].geometry)
            }
        })
        directionsSources.push(`directions-source-${uuid}`)

        map.addLayer({
            id: `directions-layer-${uuid}`,
            type: 'line',
            source: `directions-source-${uuid}`,
            paint: {
                'line-color': color,
                'line-width': 5
            }
        })
        directionsLayers.push(`directions-layer-${uuid}`)

        map.addLayer({
            id: `directions-arrows-${uuid}`,
            type: 'symbol',
            source: `directions-source-${uuid}`,
            layout: {
                'symbol-placement': 'line',
                'text-field': '>', // Use a Unicode arrow character as the text
                'text-size': 32,
                'text-rotation-alignment': 'map',
                'text-rotate': ['get', 'bearing'],
                'text-keep-upright': false
            },
            paint: {
                'text-color': color,
                'text-halo-color': '#FFFFFF',
                'text-halo-width': 5
            }
        })
        directionsLayers.push(`directions-arrows-${uuid}`)

        const src = document.getElementById(route.vehicle).src
        var popup = new mapboxgl.Popup({ closeOnClick: false, closeButton: false, closeOnMove: true, offset: [0, -20] })
            .setHTML(`<div>${route.vehicle}</div><div><img class="vehicle" src=${src} /></div>`)

        map.on('mouseenter', `directions-layer-${uuid}`, function (e) {
            popup.setLngLat(e.lngLat)
            .addTo(map)
        });

        map.on('mouseleave', `directions-layer-${uuid}`, function (e) {
            popup.remove()
        });

        document.getElementById('radio-two').disabled = false
        document.getElementById('radio-one').disabled = false
        document.getElementsByClassName('mapboxgl-ctrl-geocoder--input')[0].disabled = false
        removeLoading()
    })
}

function removeDirectionsLayers(){
    directionsLayers.forEach(layer => {
        if (map.getLayer(layer)) {
            map.removeLayer((layer))
        }
    })
    directionsLayers = []

    directionsSources.forEach(source => {
        if (map.getSource(source)) {
            map.removeSource((source))
        }
    })
}

window.isInMode = () => {
    const checked = document.getElementById('radio-one').checked
    return checked
}

window.toggleInMode = () => {
    if (!isInMode()) {
        const inmode_contents = document.getElementById('inmode-contents')
        inmode_contents.style = 'display:none;'
        const outmode_contents = document.getElementById('outmode-contents')
        outmode_contents.style = 'display:block;'
        hideCalculateLayer()
    } else {
        const inmode_contents = document.getElementById('inmode-contents')
        inmode_contents.style = 'display:block;'
        const outmode_contents = document.getElementById('outmode-contents')
        outmode_contents.style = 'display:none;'
        showCalculateLayer()
    }
}

function hideCalculateLayer() {
    if (map.getLayer('shipments-layer')) {
        map.setLayoutProperty('shipments-layer', 'visibility', 'none')
        map.setLayoutProperty('arrows', 'visibility', 'none')
    }
    directionsLayers.forEach(layer => {
        if (map.getLayer(layer)) {
            map.setLayoutProperty(layer, 'visibility', 'visible')
        }
    })

    //hideMarkers()
}
function showCalculateLayer() {
    if (map.getLayer('shipments-layer')) {
        map.setLayoutProperty('shipments-layer', 'visibility', 'visible')
        map.setLayoutProperty('arrows', 'visibility', 'visible')
    }
    directionsLayers.forEach(layer => {
        if (map.getLayer(layer)) {
            map.setLayoutProperty(layer, 'visibility', 'none')
        }
    })
}

function getCurrentDate() {
    const currentDate = new Date();

    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}
function getFullTime(time) {
    return `${getCurrentDate()}T${time}:00.000Z`
}

window.recoverShipment = (clickedFeature) => {
    document.getElementById('shipment-id').value = clickedFeature.properties.id
    document.getElementById('shipment-pickup-startime').value = clickedFeature.properties.pickup_starttime
    document.getElementById('shipment-pickup-endtime').value = clickedFeature.properties.pickup_endtime
    document.getElementById('shipment-dropoff-startime').value = clickedFeature.properties.dropoff_starttime
    document.getElementById('shipment-dropoff-endtime').value = clickedFeature.properties.dropoff_endtime
    document.getElementById('shipment-item-count').value = clickedFeature.properties.item_count
    document.getElementById('shipment-pickup-duration').value = clickedFeature.properties.pickup_duration
    document.getElementById('shipment-dropoff-duration').value = clickedFeature.properties.dropoff_duration
    document.getElementById('shipment-requirements').value = clickedFeature.properties.requirements
}

window.submitShipment = () => {
    const id = document.getElementById('shipment-id').value
    const features = map.getSource('shipments-source')._data.features
    for (const feature of features) {
        if (feature.properties.id === id) {
            feature.properties.pickup_starttime = document.getElementById('shipment-pickup-startime').value
            feature.properties.pickup_endtime = document.getElementById('shipment-pickup-endtime').value
            feature.properties.dropoff_starttime = document.getElementById('shipment-dropoff-startime').value
            feature.properties.dropoff_endtime = document.getElementById('shipment-dropoff-endtime').value
            feature.properties.item_count = document.getElementById('shipment-item-count').value
            feature.properties.pickup_duration = document.getElementById('shipment-pickup-duration').value
            feature.properties.dropoff_duration = document.getElementById('shipment-dropoff-duration').value
            feature.properties.requirements = document.getElementById('shipment-requirements').value
            break
        }
    }
    const newData = {
        type: 'FeatureCollection',
        features: features,
    }
    map.getSource('shipments-source').setData(newData)
    var shipmentModal = document.getElementById('shipment-modal')
    shipmentModal.style.display = 'none'
    clearShipmentModal()
}

window.clearShipmentModal = () => {
    document.getElementById('shipment-pickup-startime').value = ''
    document.getElementById('shipment-pickup-endtime').value = ''
    document.getElementById('shipment-dropoff-startime').value = ''
    document.getElementById('shipment-dropoff-endtime').value = ''
    document.getElementById('shipment-item-count').value = ''
    document.getElementById('shipment-pickup-duration').value = ''
    document.getElementById('shipment-dropoff-duration').value = ''
    document.getElementById('shipment-requirements').value = ''
}
let clickedCoordinates
map.on('contextmenu', function (e) {
    if (!isInMode()) return
    clickedCoordinates = e.lngLat;
    var modal = document.getElementById('modal');
    var pixelPosition = map.project(clickedCoordinates);
    modal.style.top = pixelPosition.y + 'px';
    modal.style.left = pixelPosition.x + 'px';
    modal.style.display = 'block';

    resetDragLayer()
    isDragging = false
})

map.on('click', function (e) {
    if (!isInMode()) return
    var modal = document.getElementById('modal')
    modal.style.display = 'none'
    var shipmentModal = document.getElementById('shipment-modal')
    shipmentModal.style.display = 'none'
    var shipmentModal = document.getElementById('vehicle-modal')
    shipmentModal.style.display = 'none'
    let nearestPoint = getCoordinatesWithinRadius([e.lngLat.lng, e.lngLat.lat])
    if (nearestPoint == null) {
        resetDragLayer()
        isDragging = false
    }
})

let cursorCoordinates;
map.on('mousemove', function (e) {
    cursorCoordinates = e.lngLat
    if (isDragging) updateDragging()
})

let markerList = []
window.addTypeMarker = (type) => {
    addMarker(type)
    const marker = {
        type: type,
        coordinates: clickedCoordinates
    }
    markerList.push(marker)
    var modal = document.getElementById('modal');
    modal.style.display = 'none';
}

const type_color = {
    pickup: 'red',
    dropoff: 'green',
    vehicle: 'blue'
}

let isDragging = false
let leftClickedCoordinates
let connect_properties = {
    coordinates: [],
    start_type: "",
    name: ""
}
let connectionsList = []
window.appendConnections = (coordinates) => {
    let container
    let error = false
    connectionsList.forEach(connections => {
        if (connect_properties.start_type === 'pickup') {
            if (connect_properties.coordinates.lng == connections.pickup_coordinates.lng &&
                connect_properties.coordinates.lat == connections.pickup_coordinates.lat) {
                container = connections
                container.dropoff_coordinates_list.forEach(dropoff => {
                    if (dropoff.lng == coordinates.lng &&
                        dropoff.lat == coordinates.lat) {
                        error = true
                        return
                    }
                })
                container.dropoff_coordinates_list.push(coordinates)
                return
            }
        } else {
            if (coordinates.lng === connections.pickup_coordinates.lng &&
                coordinates.lat === connections.pickup_coordinates.lat) {
                container = connections
                container.dropoff_coordinates_list.forEach(dropoff => {
                    if (dropoff.lng == connect_properties.coordinates.lng &&
                        dropoff.lat == connect_properties.coordinates.lat) {
                        error = true
                        return
                    }
                })
                container.dropoff_coordinates_list.push(connect_properties.coordinates)
                return
            }
        }
    })
    if (error) {
        alert("設定済みです。")
    }
    if (!container) {
        container = {
            pickup_coordinates: [],
            dropoff_coordinates_list: []
        }
        if (connect_properties.start_type === 'pickup') {
            container.pickup_coordinates = connect_properties.coordinates
            container.dropoff_coordinates_list.push(coordinates)
        } else {
            container.pickup_coordinates = coordinates
            container.dropoff_coordinates_list.push(connect_properties.coordinates)
        }
        connectionsList.push(container)
    }

}
let markerArray = []
let markerCounter = {
    "pickup": 0,
    "dropoff": 0,
    "vehicle": 0
}
const markerNameConverter = {
    "pickup": "集荷",
    "dropoff": "配達",
    "vehicle": "機関"
}
let markers = []
// Function to hide all markers
function hideMarkers() {
    // Loop through the markers array and remove them from the map
    markers.forEach(function (marker) {
        marker.remove(); // Remove the marker from the map
    });
}
// Function to show all markers
function showMarkers() {
    // Loop through the markers array and add them back to the map
    markers.forEach(function (marker) {
        marker.addTo(map); // Add the marker back to the map
    });
}
function getMarkerName(type) {
    let count = markerCounter[type]
    count++
    markerCounter[type] = count
    let name = type + '-' + count
    name = name.replace(type, markerNameConverter[type])
    return name
}
window.addMarker = function (type) {
    const name = getMarkerName(type)
    markerArray[name] = { coordinates: clickedCoordinates }
    var marker = new mapboxgl.Marker({ color: type_color[type] })
        .setLngLat(clickedCoordinates)
        .addTo(map)
    markers.push(marker)

    var popup = new mapboxgl.Popup({ closeOnClick: false, closeButton: false, closeOnMove: true, offset: [0, -20] })
        .setLngLat(clickedCoordinates)
        .setHTML(`<div>${name}</div>`)

    marker.getElement().addEventListener('mouseenter', function () {
        popup.addTo(map)
    });

    marker.getElement().addEventListener('mouseleave', function () {
        popup.remove()
    });

    marker.getElement().addEventListener('click', (e) => {
        //is out mode
        if (!isInMode()) return
        //is already dragging line
        if (isDragging) {
            e.stopPropagation()
            //cannot connect unless opposite point type
            if (connect_properties.start_type === type) {
                //alert("集荷と配達ポイントを接続して下さい。")
                return
            }
            //connect to end point
            addToShipments(marker.getLngLat(), name)
            appendConnections(marker.getLngLat())
            resetDragLayer()
            isDragging = false
            return
        }
        //start dragging line
        leftClickedCoordinates = getClosestCoordinates(map.unproject([e.clientX, e.clientY]))
        resetDragLayer()
        map.addSource('drag-source', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: []
                }
            }
        })
        map.addLayer({
            id: 'drag-layer',
            type: 'line',
            source: 'drag-source',
            paint: {
                'line-color': 'black',
                'line-width': 5
            }
        })
        isDragging = true
        connect_properties.coordinates = marker.getLngLat()
        connect_properties.start_type = type
        connect_properties.name = name
    })
}

window.updateDragging = () => {
    const lineCoordinates = [
        [leftClickedCoordinates.lng, leftClickedCoordinates.lat],
        [cursorCoordinates.lng, cursorCoordinates.lat]
    ]
    map.getSource('drag-source').setData({
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: lineCoordinates
        }
    })
}

window.resetDragLayer = () => {
    if (map.getLayer('drag-layer')) {
        map.removeLayer(('drag-layer'))
    }
    if (map.getSource('drag-source')) {
        map.removeSource('drag-source')
    }
}

window.addToShipments = (clickedCoordinates, id) => {
    let from
    let to
    let lineCoordinates = []
    if (connect_properties.start_type === 'pickup') {
        lineCoordinates.push([connect_properties.coordinates.lng, connect_properties.coordinates.lat])
        lineCoordinates.push([clickedCoordinates.lng, clickedCoordinates.lat])
        from = connect_properties.name
        to = id
    } else {
        lineCoordinates.push([clickedCoordinates.lng, clickedCoordinates.lat])
        lineCoordinates.push([connect_properties.coordinates.lng, connect_properties.coordinates.lat])
        from = id
        to = connect_properties.name
    }
    const newFeature = [
        {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: lineCoordinates
            },
            properties: {
                id: uuidv4(),
                from: from,
                to: to,
                pickup_starttime: '',
                pickup_endtime: '',
                dropoff_starttime: '',
                dropoff_endtime: '',
                item_count: '',
                pickup_duration: '',
                dropoff_duration: '',
                requirements: ''
            }
        }
    ]
    const existingData = map.getSource('shipments-source')._data
    const newData = {
        type: 'FeatureCollection',
        features: [...existingData.features, ...newFeature],
    }
    map.getSource('shipments-source').setData(newData)
}

function getClosestCoordinates(coords) {
    const pointFeature = turf.point([coords.lng, coords.lat]);

    let closestCoordinates
    let nearestDistance
    markerList.forEach(marker => {
        const coordinatesPoint = turf.point([marker.coordinates.lng, marker.coordinates.lat])
        const distance = turf.distance(pointFeature, coordinatesPoint)
        if (!nearestDistance || distance < nearestDistance) {
            nearestDistance = distance
            closestCoordinates = marker.coordinates
        }
    })

    return closestCoordinates
}

function getCoordinatesWithinRadius(center) {
    const centerPoint = turf.point(center);
    let radius = 10000

    for (const marker of markerList) {
        const coordinatesPoint = turf.point([marker.coordinates.lng, marker.coordinates.lat]);
        const distance = turf.distance(centerPoint, coordinatesPoint, { units: 'meters' });

        if (distance <= radius) {
            // The coordinates are within the radius
            return marker.coordinates;
        }
    }
    // No coordinates found within the radius
    return null;
}

const vehicle_img = {
    "1": "data:image/svg+xml;base64,PHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4IiB3aWR0aD0iNDkzLjM0OXB4IiBoZWlnaHQ9IjQ5My4zNDlweCIgdmlld0JveD0iMCAwIDQ5My4zNDkgNDkzLjM0OSIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNDkzLjM0OSA0OTMuMzQ5OyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSI+CjxnPgoJPHBhdGggZD0iTTQ4Ny45MzIsNTEuMWMtMy42MTMtMy42MTItNy45MDUtNS40MjQtMTIuODQ3LTUuNDI0aC0yOTIuMzZjLTQuOTQ4LDAtOS4yMzMsMS44MTItMTIuODQ3LDUuNDI0CgkJYy0zLjYxNSwzLjYxNy01LjQyNCw3LjkwMi01LjQyNCwxMi44NXY1NC44MThoLTQ1LjY4M2MtNS4xNCwwLTEwLjcxLDEuMjM3LTE2LjcwNSwzLjcxMWMtNS45OTYsMi40NzgtMTAuODAxLDUuNTE4LTE0LjQxNiw5LjEzNQoJCWwtNTYuNTMyLDU2LjUzMWMtMi40NzMsMi40NzQtNC42MTIsNS4zMjctNi40MjQsOC41NjVjLTEuODA3LDMuMjMtMy4xNCw2LjE0LTMuOTk3LDguNzA1Yy0wLjg1NSwyLjU3Mi0xLjQ3Nyw2LjA4OS0xLjg1NCwxMC41NjYKCQljLTAuMzc4LDQuNDc1LTAuNjIsNy43NTgtMC43MTUsOS44NTNjLTAuMDkxLDIuMDkyLTAuMDkxLDUuNzEsMCwxMC44NWMwLjA5Niw1LjE0MiwwLjE0NCw4LjQ3LDAuMTQ0LDkuOTk1djkxLjM2CgkJYy00Ljk0NywwLTkuMjI5LDEuODA3LTEyLjg0Nyw1LjQyOEMxLjgwOSwzNDcuMDc2LDAsMzUxLjM2MywwLDM1Ni4zMTJjMCwyLjg1MSwwLjM3OCw1LjM3NiwxLjE0LDcuNTYyCgkJYzAuNzYzLDIuMTksMi4wNDYsMy45NDksMy44NTgsNS4yODRjMS44MDcsMS4zMzUsMy4zNzgsMi40MjYsNC43MDksMy4yODVjMS4zMzUsMC44NTUsMy41NzEsMS40MjQsNi43MTEsMS43MTEKCQlzNS4yOCwwLjQ3OSw2LjQyMywwLjU3NWMxLjE0MywwLjA4OSwzLjU2OCwwLjA4OSw3LjI3OSwwYzMuNzE1LTAuMDk2LDUuODU1LTAuMTQ0LDYuNDI3LTAuMTQ0aDE4LjI3MQoJCWMwLDIwLjE3LDcuMTM5LDM3LjM5NywyMS40MTEsNTEuNjc0YzE0LjI3NywxNC4yNzQsMzEuNTAxLDIxLjQxMyw1MS42NzgsMjEuNDEzYzIwLjE3NSwwLDM3LjQwMS03LjEzOSw1MS42NzUtMjEuNDEzCgkJYzE0LjI3Ny0xNC4yNzYsMjEuNDExLTMxLjUwNCwyMS40MTEtNTEuNjc0SDMxMC42M2MwLDIwLjE3LDcuMTM5LDM3LjM5NywyMS40MTIsNTEuNjc0YzE0LjI3MSwxNC4yNzQsMzEuNDk4LDIxLjQxMyw1MS42NzUsMjEuNDEzCgkJYzIwLjE4MSwwLDM3LjM5Ny03LjEzOSw1MS42NzUtMjEuNDEzYzE0LjI3Ny0xNC4yNzYsMjEuNDEyLTMxLjUwNCwyMS40MTItNTEuNjc0YzAuNTY4LDAsMi43MTEsMC4wNDgsNi40MiwwLjE0NAoJCWMzLjcxMywwLjA4OSw2LjE0LDAuMDg5LDcuMjgyLDBjMS4xNDQtMC4wOTYsMy4yODktMC4yODgsNi40MjctMC41NzVjMy4xMzktMC4yODcsNS4zNzMtMC44NTUsNi43MDgtMS43MTFzMi45MDEtMS45NSw0LjcwOS0zLjI4NQoJCWMxLjgxLTEuMzM1LDMuMDk3LTMuMDk0LDMuODU2LTUuMjg0YzAuNzctMi4xODcsMS4xNDMtNC43MTIsMS4xNDMtNy41NjJWNjMuOTUzQzQ5My4zNTMsNTkuMDA0LDQ5MS41NDYsNTQuNzI0LDQ4Ny45MzIsNTEuMXoKCQkgTTE1My41OTcsNDAwLjI4Yy03LjIyOSw3LjIzLTE1Ljc5NywxMC44NTQtMjUuNjk0LDEwLjg1NGMtOS44OTgsMC0xOC40NjQtMy42Mi0yNS42OTctMTAuODU0CgkJYy03LjIzMy03LjIyOC0xMC44NDgtMTUuNzk3LTEwLjg0OC0yNS42OTNjMC05Ljg5NywzLjYxOS0xOC40NywxMC44NDgtMjUuNzAxYzcuMjMyLTcuMjI4LDE1Ljc5OC0xMC44NDgsMjUuNjk3LTEwLjg0OAoJCWM5Ljg5NywwLDE4LjQ2NCwzLjYxNywyNS42OTQsMTAuODQ4YzcuMjM2LDcuMjMxLDEwLjg1MywxNS44MDQsMTAuODUzLDI1LjcwMUMxNjQuNDUsMzg0LjQ4MywxNjAuODMzLDM5My4wNTIsMTUzLjU5Nyw0MDAuMjh6CgkJIE0xNjQuNDUsMjI4LjQwM0g1NC44MTR2LTguNTYyYzAtMi40NzUsMC44NTUtNC41NjksMi41NjgtNi4yODNsNTUuNjc0LTU1LjY3MmMxLjcxMi0xLjcxNCwzLjgwOS0yLjU2OCw2LjI4My0yLjU2OGg0NS4xMTEKCQlWMjI4LjQwM3ogTTQwOS40MSw0MDAuMjhjLTcuMjMsNy4yMy0xNS43OTcsMTAuODU0LTI1LjY5MywxMC44NTRjLTkuOSwwLTE4LjQ3LTMuNjItMjUuNy0xMC44NTQKCQljLTcuMjMxLTcuMjI4LTEwLjg0OS0xNS43OTctMTAuODQ5LTI1LjY5M2MwLTkuODk3LDMuNjE3LTE4LjQ3LDEwLjg0OS0yNS43MDFjNy4yMy03LjIyOCwxNS44LTEwLjg0OCwyNS43LTEwLjg0OAoJCWM5Ljg5NiwwLDE4LjQ2MywzLjYxNywyNS42OTMsMTAuODQ4YzcuMjMxLDcuMjM1LDEwLjg1MiwxNS44MDQsMTAuODUyLDI1LjcwMUM0MjAuMjYyLDM4NC40ODMsNDE2LjY0OCwzOTMuMDUyLDQwOS40MSw0MDAuMjh6IiBpZD0iaWRfMTAzIiBzdHlsZT0iZmlsbDogcmdiKDI1NSwgMTY1LCAwKTsiPjwvcGF0aD4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8L3N2Zz4=",
    "2": "data:image/svg+xml;base64,PHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJiaWN5Y2xlLTE1IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNXB4IiBoZWlnaHQ9IjE1cHgiIHZpZXdCb3g9IjAgMCAxNSAxNSI+CiAgPHBhdGggaWQ9InBhdGg0NjY4IiBkPSIKCU03LjUsMmMtMC42NzYxLTAuMDEtMC42NzYxLDEuMDA5NiwwLDFIOXYxLjI2NTZsLTIuODAyNywyLjMzNEw1LjIyMjYsNEg1LjVjMC42NzYxLDAuMDEsMC42NzYxLTEuMDA5NiwwLTFoLTIKCWMtMC42NzYxLTAuMDEtMC42NzYxLDEuMDA5NiwwLDFoMC42NTIzTDUuMDQzLDYuMzc1QzQuNTc1Miw2LjE0MjQsNC4wNTU5LDYsMy41LDZDMS41NzI5LDYsMCw3LjU3MjksMCw5LjVTMS41NzI5LDEzLDMuNSwxMwoJUzcsMTEuNDI3MSw3LDkuNWMwLTAuNjY5OS0wLjIwMDMtMS4yOTExLTAuNTI5My0xLjgyNDJMOS4yOTEsNS4zMjYybDAuNDYyOSwxLjE2MDJDOC43MTE0LDcuMDkzNyw4LDguMjExMiw4LDkuNQoJYzAsMS45MjcxLDEuNTcyOSwzLjUsMy41LDMuNVMxNSwxMS40MjcxLDE1LDkuNVMxMy40MjcxLDYsMTEuNSw2Yy0wLjI4MzEsMC0wLjU1NDQsMC4wNDM0LTAuODE4NCwwLjEwNzRMMTAsNC40MDIzVjIuNQoJYzAtMC4yNzYxLTAuMjIzOS0wLjUtMC41LTAuNUg3LjV6IE0zLjUsN2MwLjU5MjMsMCwxLjEyNzYsMC4yMTE5LDEuNTU0NywwLjU1MjdsLTEuODc1LDEuNTYyNQoJYy0wLjUxMDksMC40MjczLDAuMTI3OCwxLjE5NDUsMC42NDA2LDAuNzY5NWwxLjg3NS0xLjU2MjVDNS44ODM1LDguNjc0LDYsOS4wNzExLDYsOS41QzYsMTAuODg2Niw0Ljg4NjYsMTIsMy41LDEyUzEsMTAuODg2NiwxLDkuNQoJUzIuMTEzMyw3LDMuNSw3TDMuNSw3eiBNMTEuNSw3QzEyLjg4NjYsNywxNCw4LjExMzQsMTQsOS41UzEyLjg4NjYsMTIsMTEuNSwxMlM5LDEwLjg4NjYsOSw5LjVjMC0wLjg3NywwLjQ0NjgtMS42NDIxLDEuMTI1LTIuMDg3OQoJbDAuOTEwMiwyLjI3MzRjMC4yNDYsMC42MjMxLDEuMTgwNCwwLjI1MDEsMC45Mjk3LTAuMzcxMWwtMC45MDgyLTIuMjY5NUMxMS4yMDA5LDcuMDE5MywxMS4zNDgxLDcsMTEuNSw3TDExLjUsN3oiIHN0eWxlPSJmaWxsOiByZ2IoMjU1LCAxNjUsIDApOyI+PC9wYXRoPgo8L3N2Zz4=",
    "3": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTNweCIgaGVpZ2h0PSIyMnB4IiB2aWV3Qm94PSIwIDAgMTMgMjIiIHZlcnNpb249IjEuMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayI+CiAgICA8IS0tIEdlbmVyYXRvcjogU2tldGNoIDUyLjUgKDY3NDY5KSAtIGh0dHA6Ly93d3cuYm9oZW1pYW5jb2RpbmcuY29tL3NrZXRjaCAtLT4KICAgIDx0aXRsZT5kaXJlY3Rpb25zX3dhbGs8L3RpdGxlPgogICAgPGRlc2M+Q3JlYXRlZCB3aXRoIFNrZXRjaC48L2Rlc2M+CiAgICA8ZyBpZD0iSWNvbnMiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIiBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPgogICAgICAgIDxnIGlkPSJSb3VuZGVkIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgtMjA5LjAwMDAwMCwgLTMxMjMuMDAwMDAwKSI+CiAgICAgICAgICAgIDxnIGlkPSJNYXBzIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxMDAuMDAwMDAwLCAzMDY4LjAwMDAwMCkiPgogICAgICAgICAgICAgICAgPGcgaWQ9Ii1Sb3VuZC0vLU1hcHMtLy1kaXJlY3Rpb25zX3dhbGsiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDEwMy4wMDAwMDAsIDU0LjAwMDAwMCkiPgogICAgICAgICAgICAgICAgICAgIDxnPgogICAgICAgICAgICAgICAgICAgICAgICA8cG9seWdvbiBpZD0iUGF0aCIgcG9pbnRzPSIwIDAgMjQgMCAyNCAyNCAwIDI0Ij48L3BvbHlnb24+CiAgICAgICAgICAgICAgICAgICAgICAgIDxwYXRoIGQ9Ik0xMy41LDUuNSBDMTQuNiw1LjUgMTUuNSw0LjYgMTUuNSwzLjUgQzE1LjUsMi40IDE0LjYsMS41IDEzLjUsMS41IEMxMi40LDEuNSAxMS41LDIuNCAxMS41LDMuNSBDMTEuNSw0LjYgMTIuNCw1LjUgMTMuNSw1LjUgWiBNOS44LDguOSBMNy4yNCwyMS44MSBDNy4xMSwyMi40MiA3LjU5LDIzIDguMjIsMjMgTDguMywyMyBDOC43NywyMyA5LjE3LDIyLjY4IDkuMjgsMjIuMjIgTDEwLjksMTUgTDEzLDE3IEwxMywyMiBDMTMsMjIuNTUgMTMuNDUsMjMgMTQsMjMgQzE0LjU1LDIzIDE1LDIyLjU1IDE1LDIyIEwxNSwxNi4zNiBDMTUsMTUuODEgMTQuNzgsMTUuMjkgMTQuMzgsMTQuOTEgTDEyLjksMTMuNSBMMTMuNSwxMC41IEMxNC41NywxMS43NCAxNi4xMiwxMi42MyAxNy44NiwxMi45MSBDMTguNDYsMTMgMTksMTIuNTIgMTksMTEuOTEgQzE5LDExLjQyIDE4LjY0LDExLjAxIDE4LjE1LDEwLjkzIEMxNi42MywxMC42OCAxNS4zNyw5Ljc4IDE0LjcsOC42IEwxMy43LDcgQzEzLjE0LDYuMTEgMTIuMDIsNS43NSAxMS4wNSw2LjE2IEw3LjIyLDcuNzggQzYuNDgsOC4xIDYsOC44MiA2LDkuNjMgTDYsMTIgQzYsMTIuNTUgNi40NSwxMyA3LDEzIEM3LjU1LDEzIDgsMTIuNTUgOCwxMiBMOCw5LjYgTDkuOCw4LjkgWiIgaWQ9IvCflLktSWNvbi1Db2xvciIgZmlsbD0iI2ZmYTUwMCI+PC9wYXRoPgogICAgICAgICAgICAgICAgICAgIDwvZz4KICAgICAgICAgICAgICAgIDwvZz4KICAgICAgICAgICAgPC9nPgogICAgICAgIDwvZz4KICAgIDwvZz4KPC9zdmc+",
}

const vehicle_profile = {
    "1": "mapbox/driving",
    "2": "mapbox/cycling",
    "3": "mapbox/walking",
}

function getPropertyName(obj, value) {
    for (let prop in obj) {
      if (obj.hasOwnProperty(prop) && obj[prop] === value) {
        return prop;
      }
    }
    return null;
  }

window.appendVehicle = () => {
    const name = getMarkerName('vehicle')
    const vehicle = {
        name: name
    }
    setVehicleData(vehicle)
    solution_request.vehicles.push(vehicle)

    const container = document.getElementById('vehicles')
    const img = container.appendChild(document.createElement('img'))
    img.className = 'vehicle'
    const type = document.getElementById('vehicle-type').value
    img.src = vehicle_img[type]
    img.onclick = function (event) {
        updateVehicle(event, name)
    }
    img.id = name
    img.title = name

    clearVehicleModal()
}

window.modVehicle = (img) => {
    const type = document.getElementById('vehicle-type').value
    img.src = vehicle_img[type]

    const name = img.id
    solution_request.vehicles.forEach(vehicle => {
        if (vehicle.name === name) {
            setVehicleData(vehicle)
        }
    })

    clearVehicleModal()
}

window.delVehicle = () => {
    const name = document.getElementById('target-vehicle-id').value
    let index = 0;
    for (let vehicle of solution_request.vehicles) {
        if (vehicle.name === name) {
            break
        }
        index++
    }
    solution_request.vehicles.splice(index, 1)
    document.getElementById(name).remove()

    clearVehicleModal()
}

function setVehicleData(vehicle){
    const type = document.getElementById('vehicle-type').value
    let earliestStart = document.getElementById('vehicle-starttime').value
    if(earliestStart !== ""){
        earliestStart = getFullTime(earliestStart)
    }
    let latestEnd = document.getElementById('vehicle-endtime').value
    if(latestEnd !== ""){
        latestEnd = getFullTime(latestEnd)
    }
    vehicle['routing_profile'] = vehicle_profile[type]
    vehicle['start_location'] = document.getElementById('vehicle-startplace').value
    vehicle['end_location'] = document.getElementById('vehicle-endplace').value
    if(document.getElementById('vehicle-item-count').value){
        vehicle['capacities'] = {
            boxes: parseInt(document.getElementById('vehicle-item-count').value)
        }
    }
    vehicle['earliest_start'] = earliestStart
    vehicle['latest_end'] = latestEnd
    if(document.getElementById('vehicle-requirements').value){
        vehicle['capabilities'] = [document.getElementById('vehicle-requirements').value]
    }else{
        vehicle['capabilities'] = []
    }
}

function resurrectVehicleData(name){
    for (let vehicle of solution_request.vehicles) {
        if (vehicle.name === name) {
            const vehicleType = getPropertyName(vehicle_profile, vehicle.routing_profile)
            document.getElementById('vehicle-type').value = vehicleType
            document.getElementById('vehicle-startplace').value = vehicle['start_location']
            document.getElementById('vehicle-endplace').value = vehicle['end_location']
            if(vehicle['capacities']){
                document.getElementById('vehicle-item-count').value = vehicle['capacities'].boxes
            }else{
                document.getElementById('vehicle-item-count').value = ''
            }
            if(vehicle['earliest_start']){
                document.getElementById('vehicle-starttime').value = vehicle['earliest_start'].substring(vehicle['earliest_start'].indexOf("T")+1,vehicle['earliest_start'].lastIndexOf(":"))
            }else{
                document.getElementById('vehicle-starttime').value = ''
            }
            if(vehicle['latest_end']){
                document.getElementById('vehicle-endtime').value = vehicle['latest_end'].substring(vehicle['latest_end'].indexOf("T")+1,vehicle['latest_end'].lastIndexOf(":"))
            }else{
                document.getElementById('vehicle-endtime').value = ''
            }
            if(vehicle['capabilities'].length === 1){
                document.getElementById('vehicle-requirements').value = vehicle['capabilities'][0]
            }
            break
        }
    }
}

function clearVehicleModal(){
    var modal = document.getElementById('vehicle-modal')
    modal.style.display = 'none'
    
    document.getElementById('vehicle-startplace').value = ""
    document.getElementById('vehicle-endplace').value = ""
    document.getElementById('vehicle-starttime').value = ""
    document.getElementById('vehicle-endtime').value = ""
    document.getElementById('vehicle-item-count').value = ""
    document.getElementById('vehicle-requirements').value = ""
    document.getElementById('vehicle-item-count').value = ""
}

window.addNewVehicle = (e) => {
    showVehicleDetails(e, "")
    vehicleRemoveButton('none')
    const commitButton = document.getElementById('vehicle-commit-button')
    commitButton.onclick = function (event) {
        appendVehicle()
    }
}

window.updateVehicle = (e, id) => {
    showVehicleDetails(e, id)
    vehicleRemoveButton('block')
    resurrectVehicleData(id)
    const commitButton = document.getElementById('vehicle-commit-button')
    commitButton.onclick = function (event) {
        modVehicle(document.getElementById(id))
    }
}

function addPlaceOptions(id){
    const startplace = document.getElementById(id)
    while(startplace.firstChild){
        startplace.removeChild(startplace.firstChild)
    }
    const blankOption = startplace.appendChild(document.createElement('option'))
    for (const key in markerArray) {
        const option = startplace.appendChild(document.createElement('option'))
        option.value = key
        option.innerHTML = key
    }
}

function showVehicleDetails(e, id) {
    const modal = document.getElementById('vehicle-modal');
    modal.style.top = e.clientY + 'px';
    modal.style.left = e.clientX + 'px';
    modal.style.display = 'block';

    const targetVehicleId = document.getElementById('target-vehicle-id')
    targetVehicleId.value = id

    addPlaceOptions('vehicle-startplace')
    addPlaceOptions('vehicle-endplace')
}

function vehicleRemoveButton(display) {
    const delButton = document.getElementById('vehicle-remove-button')
    delButton.style.display = display
}

function getRandomColor() {
    var red = Math.floor(Math.random() * 256);
    var green = Math.floor(Math.random() * 256);
    var blue = Math.floor(Math.random() * 256);
    var color = "rgb(" + red + ", " + green + ", " + blue + ")";
    return color;
}

 function dispLoading(msg){
    if(msg === undefined ) msg = "";
    var innerMsg = "<div id='innerMsg'>" + msg + "</div>";  
    if($("#nowLoading").length == 0){
      $("body").append("<div id='nowLoading'>" + innerMsg + "</div>");
    }
  }
   
  function removeLoading(){
    $("#nowLoading").remove();
  }  






