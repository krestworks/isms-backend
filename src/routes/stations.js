"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const {
  listStations, createStation, getStation, updateStation,
  deleteStation, restoreStation, purgeStation,
} = require("../controllers/stationsController");

const router = Router();

router.use(authenticate);

router.get(    "/",               listStations);                                                // filtered by stations.view permission
router.post(   "/",               requirePermission("stations.create"),  createStation);
router.get(    "/:id",            getStation);
router.put(    "/:id",            requirePermission("stations.manage"),  updateStation);
router.delete( "/:id",            requirePermission("stations.manage"),  deleteStation);        // soft-delete
router.post(   "/:id/restore",    requirePermission("stations.manage"),  restoreStation);
router.delete( "/:id/purge",      requirePermission("stations.manage"),  purgeStation);        // hard-delete after 5-day grace

module.exports = router;
