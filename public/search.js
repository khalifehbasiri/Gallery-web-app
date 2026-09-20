function search() {
    const fields = ["name", "artist", "category"];
    const searchCriteria = fields.reduce((criteria, field) => {
        const value = document.getElementById(`S${field}`).value.trim();

        if (value) {
            criteria[field] = value;
        }

        return criteria;
    }, {});

    if (Object.keys(searchCriteria).length === 0) {
        return;
    }

    const xhttp = new XMLHttpRequest();

    xhttp.onload = function() {
        if (this.status >= 200 && this.status < 300) {
            window.location.href = "/searchArt";
        } else {
            alert("The artwork search could not be completed. Please try again.");
        }
    };

    xhttp.onerror = function() {
        alert("Could not connect to the server. Please try again.");
    };

    xhttp.open("POST", "/searchArt");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(searchCriteria));
}
