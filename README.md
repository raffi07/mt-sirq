# SIRQ (System for Interactive Reservation and Queue Management)

Docker is used to run this application in a container environment, please refer to the corresponding instructions to install.

## Basic Initialization

To build and run SIRQ as well as the corresponding PostgreSQL database,
navigate a shell instance to the root folder of SIRQ where the `docker-compose.yml` file
is located and run the command 

```
docker-compose up --build
```
As soon as the output of SIRQ shows the line: `CryptoKey successfully initialized` the system is ready
to be used.

## Config / Environment Variables Setup

The timing for the CRON Job, which enforces auction settling, spot assignment and refreshs charging flows
needs to be set in the Fresh specific [config file](mt-cs-sirq-app/mt-cs-brokering-fresh/fresh.config.ts). Please refer to the standard CRON notation to set timing as desired: [CRON Notation & Generator](https://crontab.cronhub.io)

The logical parameters (length of introduced constraint intervals) for SIRQ are initialized in the [.env file](mt-cs-sirq-app/mt-cs-brokering-fresh/.samplenv) with the following required entries (the application needs a real `.env` file, not the `.samplenv`):

* IP and Port of the server to access the REST API

```
IP
PORT
```
* PostgreSQL specific connection parameters and credentials for the respective Database with example values for timezone `TZ` and Postgre-timezone `PGTZ`
```
DATABASE_PORT
DATABASE_URL
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
POSTGRES_HOSTNAME
TZ=Europe/Zurich
PGTZ=Europe/Zurich
```
* Admin user role credentials for SIRQ
```
ADMIN_USER
ADMIN_PASSWORD
```
* Infrastructure user role credentials for SIRQ
```
INFRASTRUCTURE_USER
INFRASTRUCTURE_PASSWORD
```
* The duration of validity of the bearer token
```
BEARER_TOKEN_EXPIRY
```
* The interval used during auction setup to check if a reservation needs to be satisfied and therefore a corresponding slot is not included in the auction
```
AUCTION_RESERVATION_CHECK
```
* The maximum duration of an auction before it is considered as closed no matter the amount of offers received
```
AUCTION_MAXIMUM_DURATION
```
* The duration of the lock for the spot being traded in the auction, after this interval the spot will be assigned to others if the auction starter did not take it
```
AUCTION_SPOT_ASSIGN_LOCK_DURATION
```
* If all offers were received and the auction is still not exceeding the maximum duration then this interval is respected to allow even the last offer to be changed for the length of the chosen interval before the auction will be automatically closed due to receival of all offers
```
AUCTION_OFFER_MINIMUM_CHANGE_DURATION
```
* The minimum guaranteed charging time for a vehicle
```
MINIMUM_CHARGING_TIME
```
* The maximum time a vehicle is allowed to charge. Exceeding this time will result in an automatic end of the charging session.
```
MAXIMUM_CHARGING_TIME
```
* The maximum time a vehicle is allowed to take to check in at the assigned charging spot. If this is exceeded, the vehicle is considered "lost" and the spot will be reassigned.
```
MAXIMUM_CHECKIN_SLACK
```
* The maximum time a vehicle is allowed to take to check in at the assigned charging spot and plug in the charger. If this is exceeded, the vehicle is considered "lost" and the spot will be reassigned.
```
MAXIMUM_START_CHARGING_SLACK
```
* The maximum time a vehicle can take until it departs from the charging station. This is only used to set departure after a certain time to end the charging flow in the table.
```
MAXIMUM_DEPARTURE_SLACK
```
* The slack interval given to vehicles having a reservation but arriving before their actual start time of the reservation.
```
RESERVATION_EARLY_ARRIVAL_SLACK
```
* The slack interval given to vehicles having a reservation but arriving later than their actual start time of the reservation.
```
RESERVATION_LATE_ARRIVAL_SLACK
```
* The earliest point in time in the future at which a reservation can be scheduled. Otherwise the reservation feature can be misused to reserve upon arrival and jump the queue.
```
RESERVATION_EARLIEST_POSSIBLE
```
* The maximum duration a reservation is allowed to block (start - end time).
```
RESERVATION_MAXIMUM_DURATION
```
* The maximum allowed interval in the past, for which reservations can be deleted. 
```
RESERVATION_LATEST_DELETION_IN_PAST
```
* The interval used during spot assignment to check if there are any reservations scheduled and therefore impacts the current spot assignment. Must not be lower than the minimum charging time.
```
SPOT_ASSIGN_RESERVATION_LOOK_AHEAD
```
* The interval during which no new automatic CRON job is triggered, if one was already triggered during that interval.
```
CRON_BLOCK_INTERVAL
```

## Tutorial Videos

In [the tutorial clips folder](mt-cs-sirq-app/tutorial-clips), several videos show the setup of new fleets and charging stations as well as how to interact with them through reservations, the charging flow but also how auctions are done. Read the corresponding filename and see how payloads look like and how SIRQ reacts. 

Furthermore, an integration example with the visual text recognition Android application is shown.

# Visual Text Recognition

The following guide is used to install the Android app for visual recognition. It is located in the release binaries of the GitHub release.

### Easy Installation
Move the .apk file to an Android phone and install it. Ensure that the installation of unknown sources is enabled in the Android device's settings. The app requires access to the camera, which needs to be allowed upon prompt.

### Deployment via Android Studio
Since there are different versions of Android Studio which are updated frequently, refer to the official documentation for [deploying the application to a device](https://developer.android.com/studio/run/device).


### Credentials

Please be aware, that the credentials are hardcoded in the app code and if changed in the `.env` file are not automatically reflected in the app

# DISCLAIMER

All software presented here is considered a prototype. Bugs and other errors may occur. 