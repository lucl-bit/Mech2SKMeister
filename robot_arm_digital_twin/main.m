%% Robot Arm Digital Twin: IK, trajectory planning, and collision checking
% Requires: MATLAB + Robotics System Toolbox.
% Optional next step: Simscape Multibody for CAD/multibody co-simulation.

clear; clc; close all;

projectRoot = fileparts(mfilename("fullpath"));
addpath(fullfile(projectRoot, "src"));

%% Scenario parameters
cfg = struct();
cfg.dt = 0.05;                 % Simulation time step [s]
cfg.segmentTime = 2.0;         % Time for each motion segment [s]
cfg.samplesPerSegment = round(cfg.segmentTime / cfg.dt) + 1;
cfg.showAnimation = true;
cfg.saveResults = true;

% Pick-and-place task frames [x y z] in meters.
task = struct();
task.homePosition = [0.35, 0.00, 0.55];
task.pickApproach = [0.45, -0.28, 0.32];
task.pickPose = [0.45, -0.28, 0.16];
task.placeApproach = [0.30, 0.33, 0.34];
task.placePose = [0.30, 0.33, 0.17];
task.toolRPY = [pi, 0, 0];     % End effector points downward.

%% Build robot and environment
robot = createDemoRobot();
env = createEnvironment();

fprintf("Robot has %d non-fixed joints.\n", numel(homeConfiguration(robot)));

%% Plan Cartesian task poses and solve IK
[waypointTforms, waypointNames] = makePickPlaceWaypoints(task);
[qWaypoints, ikInfo] = solveWaypointIK(robot, waypointTforms);

disp("IK status per waypoint:");
disp(table(string(waypointNames(:)), ikInfo.Status, ikInfo.PoseErrorNorm, ...
    'VariableNames', ["Waypoint", "Status", "PoseErrorNorm"]));

%% Generate smooth joint-space trajectory
[qTraj, qdTraj, qddTraj, time] = planJointTrajectory(qWaypoints, cfg.samplesPerSegment, cfg.dt);

%% Collision checking
[isInCollision, minDistances] = checkTrajectoryCollisions(robot, qTraj, env);
collisionRatio = nnz(isInCollision) / numel(isInCollision);

fprintf("Collision frames: %d / %d (%.1f%%)\n", ...
    nnz(isInCollision), numel(isInCollision), 100 * collisionRatio);
fprintf("Minimum measured environment clearance: %.3f m\n", min(minDistances));

%% Visualize results
plotJointProfiles(time, qTraj, qdTraj, qddTraj);
plotClearance(time, minDistances, isInCollision);

if cfg.showAnimation
    animateTrajectory(robot, qTraj, env, time, waypointTforms, waypointNames);
end

%% Save result data for report/README figures
if cfg.saveResults
    resultsDir = fullfile(projectRoot, "results");
    if ~exist(resultsDir, "dir")
        mkdir(resultsDir);
    end

    save(fullfile(resultsDir, "simulation_results.mat"), ...
        "qTraj", "qdTraj", "qddTraj", "time", "minDistances", ...
        "isInCollision", "qWaypoints", "waypointTforms", "waypointNames");
end

fprintf("Simulation finished.\n");
